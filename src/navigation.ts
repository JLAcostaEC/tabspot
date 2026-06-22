import { meetsVisibility } from "./focusable.ts";
import type {
  CompiledRoot,
  ContainerNode,
  FocusableNode,
  GridLayout,
  GrouperNode,
  NavNode,
} from "./tree.ts";
import { realIndex, type VirtualTarget } from "./virtual.ts";
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

function levelContainer(node: FocusableNode): ContainerNode {
  let cur: ContainerNode | null = node.parent;
  while (cur) {
    if (cur.kind === "root" || cur.kind === "grouper") return cur;
    cur = cur.parent;
  }
  // unreachable for valid trees
  return node.parent;
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
  if (grouper.implicit) return grouper.owner;
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

function firstVisible(
  candidates: FocusableNode[],
  mover: TabspotMoverOptions | undefined,
): FocusableNode | null {
  const threshold = mover?.visibilityAware;
  if (!threshold) return candidates[0] ?? null;
  for (const c of candidates) {
    if (meetsVisibility(c.el, threshold)) return c;
  }
  return null;
}

function lastVisible(
  candidates: FocusableNode[],
  mover: TabspotMoverOptions | undefined,
): FocusableNode | null {
  const threshold = mover?.visibilityAware;
  if (!threshold) return candidates[candidates.length - 1] ?? null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (meetsVisibility(candidates[i]!.el, threshold)) return candidates[i]!;
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
}

/** Build the index/grid context fields for a navigation event. */
function navExtra(compiled: CompiledRoot, from: FocusableNode, to: FocusableNode): NavExtra {
  const fromIndex = compiled.focusables.indexOf(from);
  const toIndex = compiled.focusables.indexOf(to);
  let grid: NavExtra["grid"];
  const mover = effectiveMover(to);
  if (mover && isGridMover(mover)) {
    const layout = getGridLayout(compiled, levelContainer(to), mover.rows);
    grid = { from: layout.pos.get(from) ?? null, to: layout.pos.get(to) ?? null };
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
  /** Apply a move's side effect: focus / aria marker / nothing, + track active. */
  applyMove: (from: FocusableNode, to: FocusableNode) => void;
}

/**
 * Returns true when the key was handled and the host should preventDefault.
 * Mutates focus by calling .focus() on the resolved target.
 */
export function handleKeydown(event: KeyboardEvent, deps: NavigationDeps): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const focusable = deps.resolveCurrent(target);
  if (!focusable) return false;

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
      const matchesImplicit =
        sub.implicit && !sub.opts.enterDirection && linearAxis(sub.mover) === directionAxis(dir);
      if (matchesExplicit || matchesImplicit) {
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
      const implicitExit = g.implicit && !g.opts.exitDirection;
      if (explicitExit || implicitExit) {
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

  return moveSibling(
    focusable,
    dir,
    mover,
    deps,
    rawEvent,
    /* allowCyclic */ mover?.cyclic === true,
  );
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
  if (!next) return false;
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
  const cyclic = mover.cyclic === true;

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
    return performMove(focusable, next, dir, rawEvent, deps);
  }

  // Vertical (grid and gridLinear): walk the column at this column index,
  // clamping the index to each row's width so ragged rows still resolve.
  const column = layout.rows.map((row) => row[Math.min(at.col, row.length - 1)]!);
  const next = pickNextVisible(column, at.row, forward, mover, cyclic);
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
    if (i === fromIdx) return null;
    const candidate = sibs[i]!;
    if (!threshold || meetsVisibility(candidate.el, threshold)) return candidate;
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
  const target = column[targetRow];
  if (!target || target === focusable) return false;
  return performMove(focusable, target, down ? "pagedown" : "pageup", rawEvent, deps);
}

function performMove(
  from: FocusableNode,
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
    from.el,
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
 * When an in-axis move clamps at the rendered edge of a virtual list, compute
 * the real index just beyond. The engine then scrolls there and re-activates.
 * Returns null when the key isn't an in-axis/vertical move or there's no real
 * index to read.
 */
export function resolveBoundaryTarget(
  focusable: FocusableNode,
  compiled: CompiledRoot,
  key: string,
): VirtualTarget | null {
  const dir = KEY_TO_DIR[key];
  if (!dir) return null;
  const mover = effectiveMover(focusable);
  if (!mover) return null;

  if (isGridMover(mover)) {
    // Only vertical crosses rows; columns are assumed rendered.
    if (HORIZONTAL.has(dir)) return null;
    const layout = getGridLayout(compiled, levelContainer(focusable), mover.rows);
    const at = layout.pos.get(focusable);
    if (!at) return null;
    const rowReal = realIndex(focusable.el);
    if (rowReal === null) return null;
    const forward = isForward(dir, compiled.rtl);
    return { kind: "grid", row: rowReal + (forward ? 1 : -1), col: at.col };
  }

  if (mover.axis !== directionAxis(dir)) return null; // cross-axis is grouper territory
  const real = realIndex(focusable.el);
  if (real === null) return null;
  const forward = isForward(dir, compiled.rtl);
  return { kind: "linear", index: real + (forward ? 1 : -1) };
}

/**
 * Commit a move that landed after a virtual scroll (no raw key event). Dispatches
 * the navigation event (flagged `atRenderedBoundary`) and applies the effect.
 */
export function commitVirtual(
  deps: NavigationDeps,
  from: FocusableNode,
  to: FocusableNode,
  direction: EnterExitDirections,
): void {
  const ev = dispatchNavigation(
    deps.listener,
    direction,
    "",
    from.el,
    to.el,
    deps.compiled.root.el,
    to.level,
    { ...navExtra(deps.compiled, from, to), atRenderedBoundary: true },
  );
  if (!ev.cancelled) deps.applyMove(from, to);
}
