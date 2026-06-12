/**
 * Single source of truth for Tabspot's closed enums.
 *
 * Each `as const` array doubles as (a) the runtime validation set used by the
 * parser and (b) the union type derived via `(typeof ARR)[number]`. Adding a
 * value means editing one array — the type and the validator never drift.
 */

export const MOVER_AXES = ["horizontal", "vertical"] as const;
export type MoverAxis = (typeof MOVER_AXES)[number];

export const MOVER_LAYOUTS = ["linear", "grid"] as const;
export type MoverLayout = (typeof MOVER_LAYOUTS)[number];

export const GRID_FLOWS = ["contained", "linear"] as const;
export type GridFlow = (typeof GRID_FLOWS)[number];

export const ENTER_EXIT_DIRECTIONS = ["left", "right", "up", "down"] as const;
export type EnterExitDirections = (typeof ENTER_EXIT_DIRECTIONS)[number];

export const VISIBILITIES = ["Invisible", "Visible"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const DEBUG_LEVELS = ["basic", "full"] as const;
export type DebugLevel = (typeof DEBUG_LEVELS)[number];

export const MANAGED_KEYS = [
  "Tab",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;
export type ManagedKey = (typeof MANAGED_KEYS)[number];

export const ACTIVATION_MODES = ["focus", "activedescendant", "marked", "controlled"] as const;
export type ActivationMode = (typeof ACTIVATION_MODES)[number];

export const ROW_STRATEGIES = ["parent", "columns", "selector", "geometry"] as const;
export type RowStrategyKind = (typeof ROW_STRATEGIES)[number];

export const RTL_MODES = ["auto", "ltr", "rtl"] as const;
export type RtlMode = (typeof RTL_MODES)[number];
