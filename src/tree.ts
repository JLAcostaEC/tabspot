import type { ActivationMode } from "./enums.ts";
import { isFocusable, walk } from "./focusable.ts";
import { readTabspotConfig } from "./parser.ts";
import type {
  ActiveMark,
  TabspotGrouperOptions,
  TabspotMoverOptions,
  TabspotRootOptions,
} from "./types.ts";

export type NodeKind = "root" | "mover" | "grouper" | "focusable";

export interface BaseNode {
  kind: NodeKind;
  el: HTMLElement;
  parent: ContainerNode | null;
  /** Depth in groupers (root = 0). Increments only when crossing a GrouperNode. */
  level: number;
}

export interface RootNode extends BaseNode {
  kind: "root";
  parent: null;
  opts: TabspotRootOptions;
  mover: TabspotMoverOptions | undefined;
  children: NavNode[];
}

export interface MoverNode extends BaseNode {
  kind: "mover";
  parent: ContainerNode;
  opts: TabspotMoverOptions;
  children: NavNode[];
}

export interface GrouperNode extends BaseNode {
  kind: "grouper";
  parent: ContainerNode;
  opts: TabspotGrouperOptions;
  /** Mover declared on the same element (or inherited). */
  mover: TabspotMoverOptions | undefined;
  /** True for groupers synthesized from a focusable's own mover. */
  implicit: boolean;
  /** Anchor focusable for implicit groupers (the focusable that owns the sub-mover). */
  owner: FocusableNode | null;
  children: NavNode[];
}

export interface FocusableNode extends BaseNode {
  kind: "focusable";
  parent: ContainerNode;
  /** Subtree that this focusable owns when it carries its own mover (e.g. Link #5). */
  subGroup: GrouperNode | null;
}

export type ContainerNode = RootNode | MoverNode | GrouperNode;
export type NavNode = ContainerNode | FocusableNode;

/**
 * 2-D layout of a grid/gridLinear mover's level. Rows are runs of focusables
 * that share the same parent element (mover-transparent flat list grouped by
 * `el.parentElement`). `pos` maps each focusable to its (row, col) coordinate.
 */
export interface GridLayout {
  rows: FocusableNode[][];
  pos: Map<FocusableNode, { row: number; col: number }>;
}

/** Resolved activation for a root: how the active item is expressed. */
export interface ResolvedActivation {
  mode: ActivationMode;
  /**
   * Element that holds focus and sources keydown for non-`focus` modes:
   * activedescendant → the configured controller (may be outside the root);
   * selected/controlled → the root element; focus → null.
   */
  controller: HTMLElement | null;
  /**
   * Class/attribute to toggle on the active item (set on active, cleared from
   * previous). Always present in `marked`; opt-in in `activedescendant`; absent
   * in `focus`/`controlled`.
   */
  mark?: ActiveMark;
}

export interface CompiledRoot {
  root: RootNode;
  /** Every focusable in the root, in document order (used by roving). */
  focusables: FocusableNode[];
  /** Whether this root manages roving tabindex (activation: focus + roving). */
  roving: boolean;
  /** Resolved activation mode + controller. */
  activation: ResolvedActivation;
  /** Resolved directionality: true when horizontal arrows are mirrored (RTL). */
  rtl: boolean;
  /** Build-time diagnostics (e.g. activation on a nested mover). */
  warnings: string[];
  /** HTMLElement -> FocusableNode lookup. */
  byElement: WeakMap<HTMLElement, FocusableNode>;
  /**
   * Per-container cache of flattened focusable siblings
   * (mover-transparent, grouper-opaque). Populated lazily by navigation.
   */
  focusablesCache: WeakMap<ContainerNode, FocusableNode[]>;
  /**
   * Per-container cache of flattened nav nodes (focusables + groupers),
   * mover-transparent. Populated lazily by navigation.
   */
  nodesCache: WeakMap<ContainerNode, NavNode[]>;
  /**
   * Per-container cache of the 2-D row/column layout for grid movers.
   * Populated lazily by navigation only when a grid mover is encountered.
   */
  gridCache: WeakMap<ContainerNode, GridLayout>;
  dirty: boolean;
}

interface BuildCtx {
  byElement: WeakMap<HTMLElement, FocusableNode>;
  /** Effective mover inherited from ancestor (root or grouper). */
  defaultMover: TabspotMoverOptions | undefined;
  /** Under roving, `tabindex="-1"` counts as a navigable item (it's how Tabspot
   * demotes inactive items). See `isFocusable`. */
  allowNeg: boolean;
  /** Every focusable collected, in document order. */
  all: FocusableNode[];
  /** Build-time diagnostics, emitted by the engine if debug is on. */
  warnings: string[];
}

/** Whether a root's mover enables roving tabindex (activation focus + roving). */
export function rovingEnabled(mover: TabspotMoverOptions | undefined): boolean {
  if (!mover) return false;
  const act = mover.activation;
  if (act === undefined || act === "focus") return true;
  if (typeof act === "object" && act.mode === "focus") return act.roving !== false;
  return false;
}

/** Resolve a root's directionality (horizontal arrows mirror when RTL). */
function resolveRtl(rootEl: HTMLElement, mode: TabspotRootOptions["rtl"]): boolean {
  if (mode === "rtl") return true;
  if (mode === "ltr") return false;
  // "auto" (default): read the computed direction.
  return getComputedStyle(rootEl).direction === "rtl";
}

/** Resolve the root's activation (from the root mover). */
function resolveActivation(
  rootEl: HTMLElement,
  mover: TabspotMoverOptions | undefined,
): ResolvedActivation {
  const act = mover?.activation;
  const asMode = typeof act === "object" ? act.mode : act;
  if (asMode === "marked") {
    // Neutral default (no ARIA selection semantics imposed); override with any
    // { class } or { attribute } — e.g. aria-selected for a real listbox.
    const mark: ActiveMark =
      typeof act === "object" && act.mode === "marked" && act.mark
        ? act.mark
        : { attribute: "data-active" };
    return { mode: "marked", controller: rootEl, mark };
  }
  if (asMode === "controlled") {
    return { mode: "controlled", controller: rootEl };
  }
  if (asMode === "activedescendant" && typeof act === "object" && "controller" in act) {
    const found = document.querySelector(act.controller);
    return {
      mode: "activedescendant",
      controller: found instanceof HTMLElement ? found : null,
      mark: act.mark, // opt-in; undefined → controller-only
    };
  }
  // default: focus
  return { mode: "focus", controller: null };
}

/** Build a fresh compiled tree from the root element. */
export function buildRootTree(rootEl: HTMLElement): CompiledRoot | null {
  const cfg = readTabspotConfig(rootEl);
  if (!cfg?.root) return null;

  const root: RootNode = {
    kind: "root",
    el: rootEl,
    parent: null,
    opts: cfg.root,
    mover: cfg.mover,
    children: [],
    level: 0,
  };

  const roving = rovingEnabled(cfg.mover);
  const ctx: BuildCtx = {
    byElement: new WeakMap(),
    defaultMover: cfg.mover,
    allowNeg: roving,
    all: [],
    warnings: [],
  };

  root.children = collectChildren(rootEl, root, ctx, 0);

  return {
    root,
    focusables: ctx.all,
    roving,
    activation: resolveActivation(rootEl, cfg.mover),
    rtl: resolveRtl(rootEl, cfg.root.rtl),
    warnings: ctx.warnings,
    byElement: ctx.byElement,
    focusablesCache: new WeakMap(),
    nodesCache: new WeakMap(),
    gridCache: new WeakMap(),
    dirty: false,
  };
}

/**
 * Collect direct navigable children inside `containerEl` for `parent`.
 * Traversal: descend through wrappers without config (and through non-focusable
 * elements), stop at:
 *   - a focusable element (becomes FocusableNode, optionally with subGroup),
 *   - a configured wrapper (mover/grouper).
 */
function collectChildren(
  containerEl: HTMLElement,
  parent: ContainerNode,
  ctx: BuildCtx,
  level: number,
): NavNode[] {
  const out: NavNode[] = [];

  for (const el of walk(containerEl, (node) => {
    // Stop descent at configured wrappers or items — they become children here.
    if (!(node instanceof HTMLElement)) return false;
    if (isConfigured(node) || isItem(node, ctx)) return true;
    return false;
  })) {
    if (!(el instanceof HTMLElement)) continue;

    const cfg = readTabspotConfig(el);
    // `activation` (and roving) are resolved only from the ROOT mover. On a
    // nested mover it's silently ignored — a footgun. Surface it in debug.
    if (cfg?.mover?.activation !== undefined) {
      ctx.warnings.push(
        "activation on a nested mover is ignored — only the root mover's activation applies; " +
          "use a separate (sibling) root for a region with a different activation mode",
      );
    }
    const elIsItem = isItem(el, ctx);

    if (cfg?.mover && !cfg.grouper && !cfg.root && !elIsItem) {
      // Mover wrapper at this level (no grouper) — keep this level (mover doesn't add level).
      const moverNode: MoverNode = {
        kind: "mover",
        el,
        parent,
        opts: cfg.mover,
        level,
        children: [],
      };
      const prevDefault = ctx.defaultMover;
      ctx.defaultMover = cfg.mover;
      moverNode.children = collectChildren(el, moverNode, ctx, level);
      ctx.defaultMover = prevDefault;
      out.push(moverNode);
      continue;
    }

    if (cfg?.grouper && !elIsItem) {
      const grouperNode: GrouperNode = {
        kind: "grouper",
        el,
        parent,
        opts: cfg.grouper,
        mover: cfg.mover ?? ctx.defaultMover,
        implicit: false,
        owner: null,
        level: level + 1,
        children: [],
      };
      const prevDefault = ctx.defaultMover;
      if (cfg.mover) ctx.defaultMover = cfg.mover;
      grouperNode.children = collectChildren(el, grouperNode, ctx, level + 1);
      ctx.defaultMover = prevDefault;
      out.push(grouperNode);
      continue;
    }

    if (isItem(el, ctx)) {
      const focusable: FocusableNode = {
        kind: "focusable",
        el,
        parent,
        level,
        subGroup: null,
      };
      ctx.byElement.set(el, focusable);
      ctx.all.push(focusable);
      out.push(focusable);

      if (cfg?.mover) {
        // Focusable owns its own subgroup: implicit grouper + mover.
        // Children inside are focusables descendants forming a subnivel.
        const sub: GrouperNode = {
          kind: "grouper",
          el,
          parent: focusable.parent, // structural marker; lives "under" the focusable
          opts: {}, // implicit grouper has no enter/exit options unless declared via grouper too
          mover: cfg.mover,
          implicit: true,
          owner: focusable,
          level: level + 1,
          children: [],
        };
        const prevDefault = ctx.defaultMover;
        ctx.defaultMover = cfg.mover;
        sub.children = collectChildren(el, sub, ctx, level + 1);
        ctx.defaultMover = prevDefault;
        focusable.subGroup = sub;
      }
      continue;
    }

    // Configured root inside this scope is forbidden; ignore (already validated by attributes helper)
    if (cfg?.root) continue;
  }

  return out;
}

function isConfigured(el: HTMLElement): boolean {
  const cfg = readTabspotConfig(el);
  return !!(cfg && (cfg.root || cfg.mover || cfg.grouper));
}

/**
 * Whether `el` is a navigable item at the current scope. When the governing
 * mover declares `items`, membership is the CSS selector (Tabspot then grants
 * focusability via roving); otherwise it falls back to focusable detection.
 */
function isItem(el: HTMLElement, ctx: BuildCtx): boolean {
  const sel = ctx.defaultMover?.items;
  if (sel) {
    try {
      return el.matches(sel);
    } catch {
      // Invalid selector — match nothing rather than throwing mid-build.
      return false;
    }
  }
  return isFocusable(el, ctx.allowNeg);
}

/** Find the registered root element that contains `target`, or null. */
export function findContainingRoot(target: Element): HTMLElement | null {
  let cur: Element | null = target;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const cfg = readTabspotConfig(cur);
      if (cfg?.root) return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}
