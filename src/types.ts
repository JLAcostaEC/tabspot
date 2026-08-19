/**
 * Public type contracts for Tabspot.
 *
 * Closed enums live in `./enums.ts` (single source of truth: array + derived
 * union). This module re-exports those unions and builds the composite shapes.
 * Internal symbols live alongside their implementations and are not re-exported
 * from `src/index.ts`.
 */

import type {
  DebugLevel,
  EnterExitDirections,
  GridFlow,
  ManagedKey,
  MoverAxis,
  RootSpecialKey,
  RtlMode,
  Visibility,
} from "./enums.ts";

export type {
  ActivationMode,
  DebugLevel,
  EnterExitDirections,
  GridFlow,
  ManagedKey,
  MoverAxis,
  MoverLayout,
  RootSpecialKey,
  RtlMode,
  Visibility,
} from "./enums.ts";

/** Short alias used in docs/configs for enter/exit compass directions. */
export type Dir = EnterExitDirections;

// ---------------------------------------------------------------------------
// Navigation event
// ---------------------------------------------------------------------------

/** A cell coordinate inside a grid mover. */
export interface GridCell {
  row: number;
  col: number;
}

export interface TabspotNavigationEvent {
  readonly direction:
    | EnterExitDirections
    | "tab"
    | "shift-tab"
    | "escape"
    | "home"
    | "end"
    | "pageup"
    | "pagedown";
  readonly key: string;
  readonly from: HTMLElement | null;
  readonly to: HTMLElement | null;
  /** Root element that owns this move. */
  readonly root: HTMLElement;
  /** Grouper depth of the destination (root = 0). */
  readonly level: number;
  /** Logical index of origin/target within the level (or grid linear order). */
  readonly fromIndex?: number;
  readonly toIndex?: number;
  /** Present only for grid movers. */
  readonly grid?: { from: GridCell | null; to: GridCell | null };
  /** Virtual lists: the move hit the edge of the rendered window (§ virtualization). */
  readonly atRenderedBoundary?: boolean;
  /**
   * The move ran out of items in `direction` — nothing moved and `to` is null.
   * That's domain information the engine can't act on but the widget can: flip
   * the calendar page, hand the query back, load the next slice. `cyclic`
   * movers wrap instead, so they never reach an edge. Calling `preventDefault()`
   * claims the key (the browser's default is suppressed).
   */
  readonly atEdge?: boolean;
  readonly cancelled: boolean;
  preventDefault(): void;
}

export type TabspotEventListener = (event: TabspotNavigationEvent) => void;

/** Custom log sink. When provided, replaces the default `console` output. */
export type TabspotLogSink = (
  level: "basic" | "full" | "warn" | "error",
  args: readonly unknown[],
) => void;

export interface TabspotOptions {
  debug?: DebugLevel;
  onNavigate?: TabspotEventListener;
  logger?: TabspotLogSink;
}

// ---------------------------------------------------------------------------
// Mover — discriminated union by `layout`
// ---------------------------------------------------------------------------

/** How grid rows are detected from the flat item list. */
export type GridRowStrategy =
  | { by: "parent" }
  | { by: "columns"; count: number }
  | { by: "selector"; row: string }
  | { by: "geometry"; tolerance?: number };

/**
 * How the "active" item is expressed when navigating. Orthogonal to `layout`.
 * - `focus` (default): real DOM focus + roving tabindex.
 * - `activedescendant`: focus stays on a controller; mark via aria-activedescendant.
 * - `selected`: mark the active item via an attribute; no DOM focus move.
 * - `controlled`: no DOM mutation; only the navigate event fires.
 */
/**
 * What to toggle on the active item: a CSS class or an attribute (set to "true").
 * Applied to the active item and removed from the previous one as you navigate.
 */
export type ActiveMark = { class: string } | { attribute: string };

export type Activation =
  // String shorthand for modes that need no required params.
  | "focus"
  | "marked" // shorthand → mark with { attribute: "aria-selected" }
  | "controlled"
  | { mode: "focus"; roving?: boolean }
  | {
      mode: "activedescendant";
      controller: string;
      /** Also mark the active option (class or attribute). Off by default. */
      mark?: ActiveMark;
    }
  | { mode: "marked"; mark?: ActiveMark } // default mark: { attribute: "data-active" }
  | { mode: "controlled" };

interface TabspotBaseMoverOptions {
  cyclic?: boolean;
  /**
   * Keys this mover should NOT handle. Only keys actually managed by Tabspot
   * are accepted. Ignored keys fall through untouched.
   */
  ignoreKeys?: readonly ManagedKey[];
  visibilityAware?: Visibility;
  /** CSS selector defining which descendants are navigable items. */
  items?: string;
  /** How the active item is expressed. Default `"focus"`. */
  activation?: Activation;
}

export interface TabspotLinearMoverOptions extends TabspotBaseMoverOptions {
  layout?: "linear";
  axis: MoverAxis;
}

export interface TabspotGridMoverOptions extends TabspotBaseMoverOptions {
  layout: "grid";
  /** Horizontal behavior at row edges. Default `"contained"`. */
  flow?: GridFlow;
  /** Row detection strategy. Default `{ by: "parent" }`. */
  rows?: GridRowStrategy;
  /** Rows jumped per PageUp/PageDown. Default 5. */
  pageSize?: number;
}

export type TabspotMoverOptions = TabspotLinearMoverOptions | TabspotGridMoverOptions;

export interface TabspotGrouperOptions {
  enterDirection?: EnterExitDirections;
  exitDirection?: EnterExitDirections;
  enterExitOnLast?: boolean;
}

export interface TabspotRootOptions {
  /**
   * Which special (non-arrow) keys Tabspot handles at the root level.
   * `Escape` exits the widget; `Home`/`End` and `PageUp`/`PageDown` jump
   * within it. Pass `true` to handle them all, or an object to toggle each
   * key individually. Omitted keys (and the absent option) default to off.
   */
  manageSpecialKeys?: boolean | Partial<Record<RootSpecialKey, boolean>>;
  /** Directionality for horizontal arrows. Default `"auto"`. */
  rtl?: RtlMode;
  debug?: DebugLevel;
}

export interface TabspotObserverOptions {
  name: string;
}

export interface TabspotNodeOptions {
  root?: TabspotRootOptions;
  grouper?: TabspotGrouperOptions;
  mover?: TabspotMoverOptions;
  observer?: TabspotObserverOptions;
}

export interface SetAttributesArgs {
  element: HTMLElement;
  config: TabspotNodeOptions;
  merge?: boolean;
}

/** Discriminated result of `setTabspotAttributes` (no overloaded `null`). */
export type SetAttributesResult =
  | { ok: true; instance: TabspotInstance | null }
  | { ok: false; reason: "invalid" | "nested-root"; message: string };

export interface TabspotInstance {
  rebuild(rootEl?: HTMLElement): void;
  update(next: Partial<TabspotOptions>): void;
  /**
   * Listen to navigation events. Unlike `options.onNavigate` — a single slot
   * that the next `tabspot()` call overwrites — subscribers are additive, so a
   * component can listen without stealing the app's listener. Pass a root to
   * receive only that root's events. Returns a detach function.
   */
  subscribe(listener: TabspotEventListener): () => void;
  subscribe(root: HTMLElement, listener: TabspotEventListener): () => void;
  destroy(): void;
}

export interface TabspotObserverRegistration {
  name: string;
  selector: string;
  config: TabspotNodeOptions;
}

export interface TabspotObserverAPI {
  observe(registration: TabspotObserverRegistration): void;
  disconnect(name: string): void;
}
