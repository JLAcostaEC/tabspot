import { meetsVisibility, safeMatches } from "./focusable.ts";
import type {
  CompiledRoot,
  ContainerNode,
  FocusableNode,
  GridLayout,
  GrouperNode,
  NavNode,
} from "./tree.ts";
import { getVirtualAdapter, realIndex, type VirtualTarget, virtualTargetIndex } from "./virtual.ts";
import type {
  EnterExitDirections,
  GridCell,
  GridRowStrategy,
  ManagedKey,
  MoverAxis,
  RootSpecialKey,
  TabspotEventListener,
  TabspotGridMoverOptions,
  TabspotMoverOptions,
  TabspotNavigationEvent,
  TabspotRootOptions,
  Visibility,
} from "./types.ts";

type NavDirection = TabspotNavigationEvent["direction"];

const HORIZONTAL = new Set<EnterExitDirections>(["left", "right"]);

const KEY_TO_DIR: Record<string, EnterExitDirections> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function directionAxis(dir: EnterExitDirections): MoverAxis {
  return HORIZONTAL.has(dir) ? "horizontal" : "vertical";
}

/** Resolve whether a root-level special key is handled (boolean or per-key form). */
function managesSpecialKey(rootOpts: TabspotRootOptions, key: RootSpecialKey): boolean {
  const m = rootOpts.manageSpecialKeys;
  if (typeof m === "boolean") return m;
  return m?.[key] === true;
}

/** Type guard: a grid mover (2-D matrix), vs a linear (1-D axis) mover. */
function isGridMover(m: TabspotMoverOptions): m is TabspotGridMoverOptions {
  return m.layout === "grid";
}

/** The 1-D axis of a (possibly undefined) mover; undefined for grid movers. */
function linearAxis(m: TabspotMoverOptions | undefined): MoverAxis | undefined {
  return m && !isGridMover(m) ? m.axis : undefined;
}

function isForward(dir: EnterExitDirections, rtl: boolean): boolean {
  if (dir === "up") return false;
  if (dir === "down") return true;
  // Horizontal: mirrored under RTL (ArrowLeft advances, ArrowRight goes back).
  return rtl ? dir === "left" : dir === "right";
}

/** Flatten focusables at this container's level (mover-transparent, grouper-opaque). */
function computeLevelFocusables(container: ContainerNode): FocusableNode[] {
  const out: FocusableNode[] = [];
  const visit = (nodes: NavNode[]) => {
    for (const child of nodes) {
      if (child.kind === "focusable") out.push(child);
      else if (child.kind === "mover") visit(child.children);
      // grouper -> deeper level, skip
    }
  };
  visit(container.children);
  return out;
}

function getLevelFocusables(compiled: CompiledRoot, container: ContainerNode): FocusableNode[] {
  let cached = compiled.focusablesCache.get(container);
  if (!cached) {
    cached = computeLevelFocusables(container);
    compiled.focusablesCache.set(container, cached);
  }
  return cached;
}

function effectiveMover(node: FocusableNode): TabspotMoverOptions | undefined {
  const cur: ContainerNode | null = node.parent;
  if (!cur) return undefined;
  if (cur.kind === "mover") return cur.opts;
  // grouper / root both expose `.mover`.
  return cur.mover;
}

/**
 * Whether `el` is a SKIPPED item of `mover`: a full member of the item list (it
 * holds its place in the index space, so virtual arithmetic and `data-index`
 * stay dense) that no move may ever rest on. Evaluated per move rather than at
 * build time, so toggling the attribute the selector tests takes effect on the
 * next keystroke.
 */
function isSkipped(el: HTMLElement, mover: TabspotMoverOptions | undefined): boolean {
  const sel = mover?.skip;
  return sel !== undefined && safeMatches(el, sel);
}

/**
 * Whether `node` is skipped under its own governing mover. Exported for the
 * engine: the roving tab stop and the virtualized boundary walk both have to
 * refuse a skipped item, and neither has the mover at hand.
 */
export function isNodeSkipped(node: FocusableNode): boolean {
  return isSkipped(node.el, effectiveMover(node));
}

/** Whether a move may rest on `candidate` (not skipped, and visible enough). */
function isLandable(
  candidate: FocusableNode,
  mover: TabspotMoverOptions | undefined,
  threshold: Visibility | undefined,
): boolean {
  if (isSkipped(candidate.el, mover)) return false;
  return !threshold || meetsVisibility(candidate.el, threshold);
}

function levelContainer(node: FocusableNode): ContainerNode {
  let cur: ContainerNode | null = node.parent;
  while (cur) {
    if (cur.kind === "root" || cur.kind === "grouper") return cur;
    cur = cur.parent;
  }
  // unreachable for valid trees
  return node.parent;
}

/**
 * Whether crossing the boundary in `dir` from `focusable` is owned by the
 * virtualization layer (handled by core's `tryVirtual` once the in-DOM move
 * clamps), rather than by an in-DOM cyclic wrap. True only at the root level of
 * a virtualized root, for the axis/rows the virtualizer windows, when the item
 * carries a real index. When true, the cyclic wrap must be deferred so it lands
 * on the real first/last item instead of the first/last *rendered* one.
 */
export function virtualHandlesBoundary(
  focusable: FocusableNode,
  compiled: CompiledRoot,
  dir: EnterExitDirections,
): boolean {
  if (!getVirtualAdapter(compiled.root.el)) return false;
  if (levelContainer(focusable).kind !== "root") return false;
  const mover = effectiveMover(focusable);
  if (!mover) return false;
  if (isGridMover(mover)) {
    if (HORIZONTAL.has(dir)) return false; // columns are not virtualized
  } else if (mover.axis !== directionAxis(dir)) {
    return false; // cross-axis is grouper territory, not virtual
  }
  return realIndex(focusable.el) !== null;
}

/** Returns the nearest GrouperNode ancestor, or null. */
function enclosingGrouper(node: FocusableNode): GrouperNode | null {
  let cur: ContainerNode | null = node.parent;
  while (cur) {
    if (cur.kind === "grouper") return cur;
    cur = cur.parent;
  }
  return null;
}

/** Find the focusable that serves as the anchor (entry point) of a grouper. */
function grouperAnchor(grouper: GrouperNode, compiled: CompiledRoot): FocusableNode | null {
  // An owned subgroup (implicit or configured group-inside-item) anchors on its
  // owning focusable; only sibling groupers resolve to the preceding focusable.
  if (grouper.owner) return grouper.owner;
  const parent = grouper.parent;
  // Walk through parent.children to find the previous focusable before the grouper.
  // The grouper may not be a direct child of parent if it's wrapped in a mover, so
  // walk recursively over the flat sequence of nav nodes at this level.
  const flat = getLevelNodes(compiled, parent);
  const idx = flat.indexOf(grouper);
  if (idx === -1) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const n = flat[i]!;
    if (n.kind === "focusable") return n;
  }
  return null;
}

/** Same as computeLevelFocusables but keeps GrouperNodes too (mover-transparent). */
function computeLevelNodes(container: ContainerNode): NavNode[] {
  const out: NavNode[] = [];
  const visit = (nodes: NavNode[]) => {
    for (const child of nodes) {
      if (child.kind === "focusable" || child.kind === "grouper") out.push(child);
      else if (child.kind === "mover") visit(child.children);
    }
  };
  visit(container.children);
  return out;
}

function getLevelNodes(compiled: CompiledRoot, container: ContainerNode): NavNode[] {
  let cached = compiled.nodesCache.get(container);
  if (!cached) {
    cached = computeLevelNodes(container);
    compiled.nodesCache.set(container, cached);
  }
  return cached;
}

/** Build a {rows, pos} layout from a pre-grouped rows array. */
function layoutFromRows(rows: FocusableNode[][]): GridLayout {
  const pos = new Map<FocusableNode, { row: number; col: number }>();
  rows.forEach((row, r) => row.forEach((node, c) => pos.set(node, { row: r, col: c })));
  return { rows, pos };
}

/** Group a flat focusable list into rows by a key function (consecutive runs). */
function groupByKey(
  focusables: FocusableNode[],
  keyOf: (n: FocusableNode) => unknown,
): FocusableNode[][] {
  const rows: FocusableNode[][] = [];
  let currentKey: unknown;
  let currentRow: FocusableNode[] | null = null;
  for (const node of focusables) {
    const key = keyOf(node);
    if (currentRow === null || key !== currentKey) {
      currentRow = [];
      rows.push(currentRow);
      currentKey = key;
    }
    currentRow.push(node);
  }
  return rows;
}

/** Cluster focusables into rows by their `getBoundingClientRect().top`. */
function groupByGeometry(focusables: FocusableNode[], tolerance: number): FocusableNode[][] {
  const metrics = focusables.map((node) => {
    const rect = node.el.getBoundingClientRect();
    return { node, top: rect.top, left: rect.left };
  });
  metrics.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: FocusableNode[][] = [];
  let rowTop = Number.NaN;
  let currentRow: FocusableNode[] | null = null;
  for (const m of metrics) {
    if (currentRow === null || Math.abs(m.top - rowTop) > tolerance) {
      currentRow = [];
      rows.push(currentRow);
      rowTop = m.top;
    }
    currentRow.push(m.node);
  }
  return rows;
}

/**
 * Partition a level's flat focusables into grid rows per the row strategy.
 * Default (`parent`): a row is a run of focusables sharing the same parent
 * element. Column index = position within the row.
 */
function computeGridLayout(
  focusables: FocusableNode[],
  strategy: GridRowStrategy | undefined,
): GridLayout {
  switch (strategy?.by) {
    case "columns": {
      const rows: FocusableNode[][] = [];
      for (let i = 0; i < focusables.length; i += strategy.count) {
        rows.push(focusables.slice(i, i + strategy.count));
      }
      return layoutFromRows(rows);
    }
    case "selector":
      return layoutFromRows(groupByKey(focusables, (n) => n.el.closest(strategy.row)));
    case "geometry":
      return layoutFromRows(groupByGeometry(focusables, strategy.tolerance ?? 1));
    default:
      // "parent" (and the default when unspecified)
      return layoutFromRows(groupByKey(focusables, (n) => n.el.parentElement));
  }
}

function getGridLayout(
  compiled: CompiledRoot,
  container: ContainerNode,
  strategy: GridRowStrategy | undefined,
): GridLayout {
  let cached = compiled.gridCache.get(container);
  if (!cached) {
    cached = computeGridLayout(getLevelFocusables(compiled, container), strategy);
    compiled.gridCache.set(container, cached);
  }
  return cached;
}

/** First candidate a move may rest on (entry, `Home`, grouper entry). */
function firstVisible(
  candidates: FocusableNode[],
  mover: TabspotMoverOptions | undefined,
): FocusableNode | null {
  const threshold = mover?.visibilityAware;
  if (!threshold && mover?.skip === undefined) return candidates[0] ?? null;
  for (const c of candidates) {
    if (isLandable(c, mover, threshold)) return c;
  }
  return null;
}

/** Last candidate a move may rest on (entry, `End`, `enterExitOnLast`). */
function lastVisible(
  candidates: FocusableNode[],
  mover: TabspotMoverOptions | undefined,
): FocusableNode | null {
  const threshold = mover?.visibilityAware;
  if (!threshold && mover?.skip === undefined) {
    return candidates[candidates.length - 1] ?? null;
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (isLandable(candidates[i]!, mover, threshold)) return candidates[i]!;
  }
  return null;
}

/** Pick first focusable when entering a grouper (respects enterExitOnLast). */
function entryTarget(grouper: GrouperNode, compiled: CompiledRoot): FocusableNode | null {
  const sibs = getLevelFocusables(compiled, grouper);
  if (sibs.length === 0) return null;
  return grouper.opts.enterExitOnLast
    ? lastVisible(sibs, grouper.mover)
    : firstVisible(sibs, grouper.mover);
}

interface NavExtra {
  fromIndex?: number;
  toIndex?: number;
  grid?: { from: GridCell | null; to: GridCell | null };
  atRenderedBoundary?: boolean;
  atEdge?: boolean;
}

/**
 * Build the index/grid context fields for a navigation event. `from` is null on
 * an entry move (the cursor was empty, see `handleEntry`).
 */
function navExtra(compiled: CompiledRoot, from: FocusableNode | null, to: FocusableNode): NavExtra {
  const fromIndex = from ? compiled.focusables.indexOf(from) : -1;
  const toIndex = compiled.focusables.indexOf(to);
  let grid: NavExtra["grid"];
  const mover = effectiveMover(to);
  if (mover && isGridMover(mover)) {
    const layout = getGridLayout(compiled, levelContainer(to), mover.rows);
    grid = { from: from ? (layout.pos.get(from) ?? null) : null, to: layout.pos.get(to) ?? null };
  }
  return {
    fromIndex: fromIndex < 0 ? undefined : fromIndex,
    toIndex: toIndex < 0 ? undefined : toIndex,
    grid,
  };
}

/** Map a key to an arrow direction, or null. */
export function keyToDirection(key: string): EnterExitDirections | null {
  return KEY_TO_DIR[key] ?? null;
}

function dispatchNavigation(
  listener: TabspotEventListener | undefined,
  direction: NavDirection,
  key: string,
  from: HTMLElement | null,
  to: HTMLElement | null,
  root: HTMLElement,
  level: number,
  extra?: NavExtra,
): TabspotNavigationEvent {
  const event: TabspotNavigationEvent = {
    direction,
    key,
    from,
    to,
    root,
    level,
    ...extra,
    cancelled: false,
    preventDefault() {
      (event as { cancelled: boolean }).cancelled = true;
    },
  };
  listener?.(event);
  return event;
}

export interface NavigationDeps {
  compiled: CompiledRoot;
  listener: TabspotEventListener | undefined;
  /** Resolve the current focusable from the keydown target (activation-aware). */
  resolveCurrent: (target: HTMLElement) => FocusableNode | null;
  /**
   * Apply a move's side effect: focus / aria marker / nothing, + track active.
   * `from` is null when the move enters the root with an empty cursor.
   */
  applyMove: (from: FocusableNode | null, to: FocusableNode) => void;
}

/**
 * Returns true when the key was handled and the host should preventDefault.
 * Mutates focus by calling .focus() on the resolved target.
 */
export function handleKeydown(event: KeyboardEvent, deps: NavigationDeps): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const focusable = deps.resolveCurrent(target);
  // No cursor yet (a non-`focus` root that nobody has navigated): enter from
  // outside instead of moving.
  if (!focusable) return handleEntry(event, deps);

  const rootOpts = deps.compiled.root.opts;
  const key = event.key;

  // Per-mover key opt-out (covers every Tabspot-managed key).
  const moverOnTarget = effectiveMover(focusable);
  if (moverOnTarget?.ignoreKeys?.includes(key as ManagedKey)) return false;

  // Escape
  if (key === "Escape" && managesSpecialKey(rootOpts, "Escape")) {
    return handleEscape(focusable, deps, event);
  }

  // Home / End / PageUp / PageDown (each gated individually by manageSpecialKeys)
  if ((key === "Home" || key === "End") && managesSpecialKey(rootOpts, key)) {
    return handleHomeEnd(focusable, key === "End", event.ctrlKey, deps, event);
  }
  if ((key === "PageUp" || key === "PageDown") && managesSpecialKey(rootOpts, key)) {
    return handlePage(focusable, key === "PageDown", deps, event);
  }

  // Arrows
  const dir = KEY_TO_DIR[key];
  if (!dir) return false;
  return handleArrow(focusable, dir, deps, event);
}

/**
 * Enter a root that has no current item, from outside it.
 *
 * Only non-`focus` roots reach this: with `activation: "focus"` the cursor IS
 * DOM focus and the entry point is `Tab` (roving tabindex), so nothing is
 * seeded and nothing is entered here. For the rest the cursor starts empty —
 * a forward key (`ArrowDown`/`ArrowRight`, mirrored under RTL, plus `Home`)
 * lands on the first item, a backward key (plus `End`) on the last. Linear
 * movers only enter on their own axis; grid movers enter on any arrow.
 */
function handleEntry(event: KeyboardEvent, deps: NavigationDeps): boolean {
  const compiled = deps.compiled;
  if (compiled.activation.mode === "focus") return false;

  const mover = compiled.root.mover;
  const key = event.key;
  if (mover?.ignoreKeys?.includes(key as ManagedKey)) return false;

  let forward: boolean;
  let direction: NavDirection;
  const dir = KEY_TO_DIR[key];
  if (dir) {
    // Cross-axis on a linear mover is grouper territory, never an entry.
    if (!mover || (!isGridMover(mover) && mover.axis !== directionAxis(dir))) return false;
    forward = isForward(dir, compiled.rtl);
    direction = dir;
  } else if ((key === "Home" || key === "End") && managesSpecialKey(compiled.root.opts, key)) {
    forward = key === "Home";
    direction = forward ? "home" : "end";
  } else {
    return false;
  }

  const sibs = getLevelFocusables(compiled, compiled.root);
  const to = forward ? firstVisible(sibs, mover) : lastVisible(sibs, mover);
  return performMove(null, to, direction, event, deps);
}

function handleArrow(
  focusable: FocusableNode,
  dir: EnterExitDirections,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
): boolean {
  const mover = effectiveMover(focusable);

  // Grid movers handle all four arrows themselves as 2-D matrix moves; they
  // never fall through to the in-axis / cross-axis (grouper) logic below.
  if (mover && isGridMover(mover)) {
    return handleGridArrow(focusable, dir, mover, deps, rawEvent);
  }

  const axis = linearAxis(mover);
  const inAxis = axis === directionAxis(dir);

  // Cross-axis: entering subgroup / sibling grouper, or exiting parent grouper.
  if (!inAxis) {
    // 1) Focusable owns a subGroup
    if (focusable.subGroup) {
      const sub = focusable.subGroup;
      const matchesExplicit = sub.opts.enterDirection === dir;
      // No enterDirection declared: an owned subgroup is entered by pressing in
      // the subgroup's own axis (cross-axis to the parent level). Covers both
      // implicit subgroups (inline mover) and configured group-inside-item.
      const matchesCrossAxis =
        !sub.opts.enterDirection && linearAxis(sub.mover) === directionAxis(dir);
      if (matchesExplicit || matchesCrossAxis) {
        return performMove(focusable, entryTarget(sub, deps.compiled), dir, rawEvent, deps);
      }
    }
    // 2) Adjacent grouper sibling whose enterDirection matches
    const adjGrouper = findAdjacentGrouperWithEnter(focusable, dir, deps.compiled);
    if (adjGrouper) {
      return performMove(focusable, entryTarget(adjGrouper, deps.compiled), dir, rawEvent, deps);
    }
    // 3) Exit enclosing grouper. Explicit exitDirection always wins; implicit
    //    groupers also auto-exit when the cross-axis is pressed.
    const g = enclosingGrouper(focusable);
    if (g) {
      const explicitExit = g.opts.exitDirection === dir;
      // Owned subgroups (implicit or group-inside-item) without an explicit
      // exitDirection auto-exit when the cross-axis is pressed.
      const crossAxisExit = !!g.owner && !g.opts.exitDirection;
      if (explicitExit || crossAxisExit) {
        return performMove(focusable, grouperAnchor(g, deps.compiled), dir, rawEvent, deps);
      }
    }
    return false;
  }

  // In-axis: move siblings; honor in-axis exitDirection with first/last gating.
  const g = enclosingGrouper(focusable);
  if (g && g.opts.exitDirection === dir && directionAxis(g.opts.exitDirection) === axis) {
    const sibs = getLevelFocusables(deps.compiled, g);
    const isLast = sibs[sibs.length - 1] === focusable;
    const isFirst = sibs[0] === focusable;
    const gatingOnLast = g.opts.enterExitOnLast === true;
    const fwd = isForward(dir, deps.compiled.rtl);
    const matchesGate = (gatingOnLast && isLast && fwd) || (!gatingOnLast && isFirst && !fwd);
    // The "gate" focusable exits in the exitDirection; reverse direction inside still navigates.
    if (matchesGate) {
      return performMove(focusable, grouperAnchor(g, deps.compiled), dir, rawEvent, deps);
    }
    // else fall through to normal sibling move (without cyclic wrap that would conflict)
    return moveSibling(focusable, dir, mover, deps, rawEvent, /* allowCyclic */ false);
  }

  // Defer the cyclic wrap to the virtual layer at a virtualized root edge, so it
  // lands on the real first/last item rather than the first/last rendered one.
  const allowCyclic =
    mover?.cyclic === true && !virtualHandlesBoundary(focusable, deps.compiled, dir);
  return moveSibling(focusable, dir, mover, deps, rawEvent, allowCyclic);
}

function moveSibling(
  focusable: FocusableNode,
  dir: EnterExitDirections,
  mover: TabspotMoverOptions | undefined,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
  allowCyclic: boolean,
): boolean {
  const container = levelContainer(focusable);
  const sibs = getLevelFocusables(deps.compiled, container);
  const idx = sibs.indexOf(focusable);
  if (idx === -1) return false;
  const forward = isForward(dir, deps.compiled.rtl);
  const next = pickNextVisible(sibs, idx, forward, mover, allowCyclic);
  if (!next) return reportEdge(focusable, dir, deps, rawEvent);
  return performMove(focusable, next, dir, rawEvent, deps);
}

/**
 * Grid navigation. Rows are detected per `mover.rows` (see `computeGridLayout`).
 * Movement clamps at the edges; `cyclic` wraps within the row (horizontal) /
 * column (vertical) — or, with `flow: "linear"`, within the whole row-major
 * sequence.
 *
 * - `flow: "contained"` (default): Left/Right move within the current row.
 * - `flow: "linear"`: Left/Right traverse the flat row-major list (the end of a
 *   row continues into the next row).
 * - both: Up/Down move within the column (same column index, clamped to the
 *   target row's width).
 */
function handleGridArrow(
  focusable: FocusableNode,
  dir: EnterExitDirections,
  mover: TabspotGridMoverOptions,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
): boolean {
  const horizontal = HORIZONTAL.has(dir);
  const forward = isForward(dir, deps.compiled.rtl);
  // For vertical moves across virtualized rows, defer the cyclic wrap to the
  // virtual layer (lands on the real first/last row). `virtualHandlesBoundary`
  // is false for horizontal moves, so within-row wrapping is preserved.
  const cyclic = mover.cyclic === true && !virtualHandlesBoundary(focusable, deps.compiled, dir);

  // flow:"linear" horizontal == 1-D move over the mover-transparent flat list.
  if (mover.flow === "linear" && horizontal) {
    return moveSibling(focusable, dir, mover, deps, rawEvent, cyclic);
  }

  const container = levelContainer(focusable);
  const layout = getGridLayout(deps.compiled, container, mover.rows);
  const at = layout.pos.get(focusable);
  if (!at) return false;

  if (horizontal) {
    // grid horizontal: stay inside the current row.
    const row = layout.rows[at.row]!;
    const next = pickNextVisible(row, at.col, forward, mover, cyclic);
    if (!next) return reportEdge(focusable, dir, deps, rawEvent);
    return performMove(focusable, next, dir, rawEvent, deps);
  }

  // Vertical (grid and gridLinear): walk the column at this column index,
  // clamping the index to each row's width so ragged rows still resolve.
  const column = layout.rows.map((row) => row[Math.min(at.col, row.length - 1)]!);
  const next = pickNextVisible(column, at.row, forward, mover, cyclic);
  if (!next) return reportEdge(focusable, dir, deps, rawEvent);
  return performMove(focusable, next, dir, rawEvent, deps);
}

function pickNextVisible(
  sibs: FocusableNode[],
  fromIdx: number,
  forward: boolean,
  mover: TabspotMoverOptions | undefined,
  cyclic: boolean,
): FocusableNode | null {
  const threshold = mover?.visibilityAware;
  const len = sibs.length;
  const step = forward ? 1 : -1;
  let i = fromIdx + step;
  let wrapped = false;
  while (true) {
    if (i < 0 || i >= len) {
      if (!cyclic || wrapped) return null;
      i = forward ? 0 : len - 1;
      wrapped = true;
      if (i === fromIdx) return null;
      continue;
    }
    // Back where we started: a cyclic lap found nothing landable. There is no
    // next item — not one more lap.
    if (i === fromIdx) return null;
    const candidate = sibs[i]!;
    if (isLandable(candidate, mover, threshold)) return candidate;
    i += step;
  }
}

function findAdjacentGrouperWithEnter(
  focusable: FocusableNode,
  dir: EnterExitDirections,
  compiled: CompiledRoot,
): GrouperNode | null {
  const container = levelContainer(focusable);
  const flat = getLevelNodes(compiled, container);
  const idx = flat.indexOf(focusable);
  if (idx === -1) return null;
  // Only look forward: a grouper is entered through its anchor, which is the
  // focusable immediately preceding it. A grouper found by walking backward
  // belongs to an earlier sibling (its anchor is not this focusable), so
  // entering it would cross sibling boundaries into a previous sibling's
  // sublevel — the bug this guards against.
  for (let i = idx + 1; i < flat.length; i++) {
    const n = flat[i]!;
    if (n.kind === "grouper") {
      return n.opts.enterDirection === dir ? n : null;
    }
    if (n.kind === "focusable") break;
  }
  return null;
}

function handleEscape(
  focusable: FocusableNode,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
): boolean {
  const g = enclosingGrouper(focusable);
  if (g) {
    const anchor = grouperAnchor(g, deps.compiled);
    return performMove(focusable, anchor, "escape", rawEvent, deps);
  }
  // At root level — blur.
  const ev = dispatchNavigation(
    deps.listener,
    "escape",
    rawEvent.key,
    focusable.el,
    null,
    deps.compiled.root.el,
    focusable.level,
  );
  if (ev.cancelled) return true;
  focusable.el.blur();
  return true;
}

function handleHomeEnd(
  focusable: FocusableNode,
  end: boolean,
  ctrl: boolean,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
): boolean {
  const mover = effectiveMover(focusable);

  // Grid (without Ctrl): Home/End jump to the start/end of the CURRENT ROW.
  if (mover && isGridMover(mover) && !ctrl) {
    const layout = getGridLayout(deps.compiled, levelContainer(focusable), mover.rows);
    const at = layout.pos.get(focusable);
    if (!at) return false;
    const row = layout.rows[at.row]!;
    const target = end ? lastVisible(row, mover) : firstVisible(row, mover);
    if (!target || target === focusable) return false;
    return performMove(focusable, target, end ? "end" : "home", rawEvent, deps);
  }

  // Linear (or grid + Ctrl): first/last of the whole level.
  const sibs = getLevelFocusables(deps.compiled, levelContainer(focusable));
  if (sibs.length === 0) return false;
  const target = end ? lastVisible(sibs, mover) : firstVisible(sibs, mover);
  if (!target || target === focusable) return false;
  return performMove(focusable, target, end ? "end" : "home", rawEvent, deps);
}

/** PageUp/PageDown: jump `pageSize` rows within the column. Grid movers only. */
function handlePage(
  focusable: FocusableNode,
  down: boolean,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
): boolean {
  const mover = effectiveMover(focusable);
  if (!mover || !isGridMover(mover)) return false;
  const layout = getGridLayout(deps.compiled, levelContainer(focusable), mover.rows);
  const at = layout.pos.get(focusable);
  if (!at) return false;
  const pageSize = mover.pageSize ?? 5;
  const column = layout.rows.map((row) => row[Math.min(at.col, row.length - 1)]!);
  const targetRow = down
    ? Math.min(at.row + pageSize, column.length - 1)
    : Math.max(at.row - pageSize, 0);
  const target = pickPageTarget(column, at.row, targetRow, mover);
  if (!target || target === focusable) return false;
  return performMove(focusable, target, down ? "pagedown" : "pageup", rawEvent, deps);
}

/**
 * Resolve where a Page jump lands when the computed row is skipped: continue
 * along the jump first (a run of skipped rows must not shorten it), then fall
 * back toward the origin (so the jump still moves instead of dying on a skipped
 * row at the edge). Returns null when nothing between the origin and either end
 * is landable.
 */
function pickPageTarget(
  column: FocusableNode[],
  fromRow: number,
  targetRow: number,
  mover: TabspotMoverOptions | undefined,
): FocusableNode | null {
  if (mover?.skip === undefined) return column[targetRow] ?? null;
  const landable = (i: number): FocusableNode | null => {
    const node = column[i];
    if (!node || isSkipped(node.el, mover)) return null;
    return node;
  };
  const away = targetRow >= fromRow ? 1 : -1;
  for (let i = targetRow; i >= 0 && i < column.length; i += away) {
    const node = landable(i);
    if (node) return node;
  }
  for (let i = targetRow - away; i !== fromRow; i -= away) {
    const node = landable(i);
    if (node) return node;
  }
  return null;
}

/**
 * Report that a move ran out of items in `dir`: dispatch a navigation event
 * with `to: null` and `atEdge`, without moving anything. Returns true when a
 * listener cancelled it, meaning it claimed the key.
 *
 * "Ran out of items" is domain information (flip the page, hand the query back,
 * load more) that the engine can't act on, so it has to leave the engine.
 */
export function emitEdge(
  deps: NavigationDeps,
  from: FocusableNode,
  direction: EnterExitDirections,
  key: string,
): boolean {
  const compiled = deps.compiled;
  const fromIndex = compiled.focusables.indexOf(from);
  let grid: NavExtra["grid"];
  const mover = effectiveMover(from);
  if (mover && isGridMover(mover)) {
    const layout = getGridLayout(compiled, levelContainer(from), mover.rows);
    grid = { from: layout.pos.get(from) ?? null, to: null };
  }
  const ev = dispatchNavigation(
    deps.listener,
    direction,
    key,
    from.el,
    null,
    compiled.root.el,
    from.level,
    { fromIndex: fromIndex < 0 ? undefined : fromIndex, grid, atEdge: true },
  );
  return ev.cancelled;
}

/**
 * Edge report for an in-DOM clamp. Deferred at a virtualized boundary: there
 * the rendered edge is not the real one, so core's virtual layer either
 * continues the move or reports the edge once it knows nothing lies beyond.
 */
function reportEdge(
  focusable: FocusableNode,
  dir: EnterExitDirections,
  deps: NavigationDeps,
  rawEvent: KeyboardEvent,
): boolean {
  if (virtualHandlesBoundary(focusable, deps.compiled, dir)) return false;
  if (!emitEdge(deps, focusable, dir, rawEvent.key)) return false;
  rawEvent.preventDefault();
  return true;
}

/** `from` is null only for an entry move (empty cursor, see `handleEntry`). */
function performMove(
  from: FocusableNode | null,
  to: FocusableNode | null,
  direction: NavDirection,
  rawEvent: KeyboardEvent,
  deps: NavigationDeps,
): boolean {
  if (!to) return false;
  const compiled = deps.compiled;
  const ev = dispatchNavigation(
    deps.listener,
    direction,
    rawEvent.key,
    from?.el ?? null,
    to.el,
    compiled.root.el,
    to.level,
    navExtra(compiled, from, to),
  );
  if (ev.cancelled) {
    rawEvent.preventDefault();
    return true;
  }
  deps.applyMove(from, to);
  return true;
}

/**
 * Resolve an out-of-range index. In range: passed through unchanged. Out of
 * range: wraps to the opposite end when `cyclic` and `total` is known (ArrowUp
 * past the first real item -> last; ArrowDown past the last -> first), else
 * null. Without a known total a cyclic wrap can't be placed, so it returns null.
 */
function wrapIndex(index: number, total: number | null, cyclic: boolean): number | null {
  if (index >= 0 && (total === null || index < total)) return index;
  if (!cyclic || total === null || total === 0) return null;
  return index < 0 ? total - 1 : 0;
}

/**
 * A boundary crossing at a virtualized edge, expressed as a WALK rather than a
 * single target.
 *
 * The row one index beyond the current item may not be landable — outside the
 * mover's `items`, or one of its `skip`ped ones — and then the move has to
 * continue in the same direction instead of vanishing. Only the caller can tell:
 * the row may not even be rendered yet. So this hands back the first candidate
 * plus the means to keep stepping.
 */
export interface BoundaryWalk {
  /** First candidate beyond the current item. */
  target: VirtualTarget;
  /**
   * The current item's own real index. A cyclic walk that arrives back here has
   * gone all the way around without finding anything landable, and a circular
   * index space has no out-of-range index to stop it — this is the stop.
   */
  origin: number;
  /** Next candidate in the same direction, or null at a non-cyclic real edge. */
  step: (from: VirtualTarget) => VirtualTarget | null;
}

/**
 * When an in-axis move clamps at the rendered edge of a virtual list, compute
 * the walk that continues it: the real index just beyond, and how to keep going.
 * With a cyclic mover and a known `total`, a move past the real first/last item
 * wraps to the opposite end. Returns null when the key isn't an in-axis/vertical
 * move, there's no real index to read, or the move runs off a non-cyclic edge.
 */
export function resolveBoundaryWalk(
  focusable: FocusableNode,
  compiled: CompiledRoot,
  key: string,
  total: number | null,
): BoundaryWalk | null {
  const dir = KEY_TO_DIR[key];
  if (!dir) return null;
  const mover = effectiveMover(focusable);
  if (!mover) return null;
  const real = realIndex(focusable.el);
  if (real === null) return null;
  const cyclic = mover.cyclic === true;
  const delta = isForward(dir, compiled.rtl) ? 1 : -1;

  if (isGridMover(mover)) {
    // Only vertical crosses rows; columns are assumed rendered.
    if (HORIZONTAL.has(dir)) return null;
    const layout = getGridLayout(compiled, levelContainer(focusable), mover.rows);
    const at = layout.pos.get(focusable);
    if (!at) return null;
    const cell = (from: number): VirtualTarget | null => {
      const row = wrapIndex(from + delta, total, cyclic);
      return row === null ? null : { kind: "grid", row, col: at.col };
    };
    const target = cell(real);
    if (!target) return null;
    return { target, origin: real, step: (from) => cell(virtualTargetIndex(from)) };
  }

  if (mover.axis !== directionAxis(dir)) return null; // cross-axis is grouper territory
  const linear = (from: number): VirtualTarget | null => {
    const index = wrapIndex(from + delta, total, cyclic);
    return index === null ? null : { kind: "linear", index };
  };
  const target = linear(real);
  if (!target) return null;
  return { target, origin: real, step: (from) => linear(virtualTargetIndex(from)) };
}

/**
 * Commit a move that landed after a virtual scroll (no raw key event). Dispatches
 * the navigation event (flagged `atRenderedBoundary`) and applies the effect.
 *
 * `from` may be null: the origin row can unmount while the list scrolls, and it
 * only feeds the event payload — dropping the whole move because of it loses a
 * keystroke the user did make.
 */
export function commitVirtual(
  deps: NavigationDeps,
  from: FocusableNode | null,
  to: FocusableNode,
  direction: EnterExitDirections,
): void {
  const ev = dispatchNavigation(
    deps.listener,
    direction,
    "",
    from?.el ?? null,
    to.el,
    deps.compiled.root.el,
    to.level,
    { ...navExtra(deps.compiled, from, to), atRenderedBoundary: true },
  );
  if (!ev.cancelled) deps.applyMove(from, to);
}
