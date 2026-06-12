import {
  ACTIVATION_MODES,
  ENTER_EXIT_DIRECTIONS,
  GRID_FLOWS,
  MANAGED_KEYS,
  MOVER_AXES,
  MOVER_LAYOUTS,
  ROW_STRATEGIES,
  RTL_MODES,
  VISIBILITIES,
} from "./enums.ts";
import type {
  ActiveMark,
  Activation,
  EnterExitDirections,
  GridRowStrategy,
  ManagedKey,
  MoverAxis,
  TabspotGridMoverOptions,
  TabspotGrouperOptions,
  TabspotLinearMoverOptions,
  TabspotMoverOptions,
  TabspotNodeOptions,
  TabspotObserverOptions,
  TabspotRootOptions,
  Visibility,
} from "./types.ts";

export const TABSPOT_ATTR = "data-tabspot";

const ROOT_KEYS = new Set(["manageEscape", "manageHomeEnd", "rtl", "debug"]);
const LINEAR_MOVER_KEYS = new Set([
  "layout",
  "axis",
  "cyclic",
  "ignoreKeys",
  "visibilityAware",
  "items",
  "activation",
]);
const GRID_MOVER_KEYS = new Set([
  "layout",
  "flow",
  "rows",
  "pageSize",
  "cyclic",
  "ignoreKeys",
  "visibilityAware",
  "items",
  "activation",
]);
const GROUPER_KEYS = new Set(["enterDirection", "exitDirection", "enterExitOnLast"]);
const OBSERVER_KEYS = new Set(["name"]);
const NODE_SECTIONS = new Set(["root", "mover", "grouper", "observer"]);

export class TabspotParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly element?: HTMLElement,
  ) {
    super(message);
    this.name = "TabspotParseError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new Error(`"${key}" must be a boolean`);
  return value;
}

function nonEmptyString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`"${key}" must be one of ${allowed.join("|")} (got ${JSON.stringify(value)})`);
  }
  return value as T;
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  what: string,
) {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`Unknown ${what} option "${key}"`);
  }
}

function validateRoot(raw: Record<string, unknown>): TabspotRootOptions {
  rejectUnknownKeys(raw, ROOT_KEYS, "root");
  const out: TabspotRootOptions = {};
  if ("manageEscape" in raw) out.manageEscape = bool(raw.manageEscape, "manageEscape");
  if ("manageHomeEnd" in raw) out.manageHomeEnd = bool(raw.manageHomeEnd, "manageHomeEnd");
  if ("rtl" in raw) out.rtl = oneOf(raw.rtl, RTL_MODES, "rtl");
  if ("debug" in raw) {
    if (raw.debug !== "basic" && raw.debug !== "full") {
      throw new Error(`"debug" must be "basic" or "full"`);
    }
    out.debug = raw.debug;
  }
  return out;
}

function validateIgnoreKeys(raw: unknown): readonly ManagedKey[] {
  if (!Array.isArray(raw) || !raw.every((k) => typeof k === "string")) {
    throw new Error(`"ignoreKeys" must be an array of managed key strings`);
  }
  for (const k of raw) {
    if (!MANAGED_KEYS.includes(k as ManagedKey)) {
      throw new Error(
        `"ignoreKeys" only accepts keys managed by Tabspot (${MANAGED_KEYS.join("|")}); got ${JSON.stringify(k)}`,
      );
    }
  }
  return raw as readonly ManagedKey[];
}

function validateMark(raw: unknown): ActiveMark {
  if (!isPlainObject(raw)) throw new Error(`"mark" must be an object { class } or { attribute }`);
  const hasClass = "class" in raw;
  const hasAttr = "attribute" in raw;
  if (hasClass === hasAttr) {
    throw new Error(`"mark" must have exactly one of "class" or "attribute"`);
  }
  rejectUnknownKeys(raw, new Set(["class", "attribute"]), "mark");
  return hasClass
    ? { class: nonEmptyString(raw.class, "mark.class") }
    : { attribute: nonEmptyString(raw.attribute, "mark.attribute") };
}

function validateActivation(raw: unknown): Activation {
  if (typeof raw === "string") {
    if (raw === "focus" || raw === "marked" || raw === "controlled") return raw;
    if (raw === "activedescendant") {
      throw new Error(
        `activation "activedescendant" requires the object form { mode, controller }`,
      );
    }
    throw new Error(
      `"activation" must be one of ${ACTIVATION_MODES.join("|")} (got ${JSON.stringify(raw)})`,
    );
  }
  if (!isPlainObject(raw)) throw new Error(`"activation" must be a string or object`);
  const mode = oneOf(raw.mode, ACTIVATION_MODES, "activation.mode");
  switch (mode) {
    case "focus": {
      rejectUnknownKeys(raw, new Set(["mode", "roving"]), "activation");
      const out: Activation = { mode: "focus" };
      if ("roving" in raw) out.roving = bool(raw.roving, "activation.roving");
      return out;
    }
    case "activedescendant": {
      rejectUnknownKeys(raw, new Set(["mode", "controller", "mark"]), "activation");
      const out: Activation = {
        mode: "activedescendant",
        controller: nonEmptyString(raw.controller, "activation.controller"),
      };
      if ("mark" in raw) out.mark = validateMark(raw.mark);
      return out;
    }
    case "marked": {
      rejectUnknownKeys(raw, new Set(["mode", "mark"]), "activation");
      const out: Activation = { mode: "marked" };
      if ("mark" in raw) out.mark = validateMark(raw.mark);
      return out;
    }
    case "controlled": {
      rejectUnknownKeys(raw, new Set(["mode"]), "activation");
      return { mode: "controlled" };
    }
  }
}

function validateRowStrategy(raw: unknown): GridRowStrategy {
  if (!isPlainObject(raw)) throw new Error(`"rows" must be an object`);
  const by = oneOf(raw.by, ROW_STRATEGIES, "rows.by");
  switch (by) {
    case "parent": {
      rejectUnknownKeys(raw, new Set(["by"]), "rows");
      return { by: "parent" };
    }
    case "columns": {
      rejectUnknownKeys(raw, new Set(["by", "count"]), "rows");
      if (typeof raw.count !== "number" || !Number.isInteger(raw.count) || raw.count < 1) {
        throw new Error(`"rows.count" must be an integer >= 1`);
      }
      return { by: "columns", count: raw.count };
    }
    case "selector": {
      rejectUnknownKeys(raw, new Set(["by", "row"]), "rows");
      return { by: "selector", row: nonEmptyString(raw.row, "rows.row") };
    }
    case "geometry": {
      rejectUnknownKeys(raw, new Set(["by", "tolerance"]), "rows");
      const out: GridRowStrategy = { by: "geometry" };
      if ("tolerance" in raw) {
        if (typeof raw.tolerance !== "number" || raw.tolerance < 0) {
          throw new Error(`"rows.tolerance" must be a number >= 0`);
        }
        out.tolerance = raw.tolerance;
      }
      return out;
    }
  }
}

function validateMover(raw: Record<string, unknown>): TabspotMoverOptions {
  const layout = "layout" in raw ? oneOf(raw.layout, MOVER_LAYOUTS, "layout") : "linear";

  // Shared (base) fields validated once below.
  const base: {
    cyclic?: boolean;
    ignoreKeys?: readonly ManagedKey[];
    visibilityAware?: Visibility;
    items?: string;
    activation?: Activation;
  } = {};
  if ("cyclic" in raw) base.cyclic = bool(raw.cyclic, "cyclic");
  if ("ignoreKeys" in raw) base.ignoreKeys = validateIgnoreKeys(raw.ignoreKeys);
  if ("visibilityAware" in raw)
    base.visibilityAware = oneOf(raw.visibilityAware, VISIBILITIES, "visibilityAware");
  if ("items" in raw) base.items = nonEmptyString(raw.items, "items");
  if ("activation" in raw) base.activation = validateActivation(raw.activation);

  if (layout === "grid") {
    rejectUnknownKeys(raw, GRID_MOVER_KEYS, "grid mover");
    const out: TabspotGridMoverOptions = { layout: "grid", ...base };
    if ("flow" in raw) out.flow = oneOf(raw.flow, GRID_FLOWS, "flow");
    if ("rows" in raw) out.rows = validateRowStrategy(raw.rows);
    if ("pageSize" in raw) {
      if (typeof raw.pageSize !== "number" || !Number.isInteger(raw.pageSize) || raw.pageSize < 1) {
        throw new Error(`"pageSize" must be an integer >= 1`);
      }
      out.pageSize = raw.pageSize;
    }
    return out;
  }

  // linear: do not force `layout` (keep the minimal shape); the absence of
  // `layout: "grid"` is what marks a mover linear.
  rejectUnknownKeys(raw, LINEAR_MOVER_KEYS, "linear mover");
  if (!("axis" in raw)) throw new Error(`linear mover requires "axis"`);
  const axis = oneOf<MoverAxis>(raw.axis, MOVER_AXES, "axis");
  const out: TabspotLinearMoverOptions = { axis, ...base };
  if (raw.layout === "linear") out.layout = "linear";
  return out;
}

function validateGrouper(raw: Record<string, unknown>): TabspotGrouperOptions {
  rejectUnknownKeys(raw, GROUPER_KEYS, "grouper");
  const out: TabspotGrouperOptions = {};
  for (const dirKey of ["enterDirection", "exitDirection"] as const) {
    if (dirKey in raw)
      out[dirKey] = oneOf<EnterExitDirections>(raw[dirKey], ENTER_EXIT_DIRECTIONS, dirKey);
  }
  if ("enterExitOnLast" in raw) out.enterExitOnLast = bool(raw.enterExitOnLast, "enterExitOnLast");
  return out;
}

function validateObserver(raw: Record<string, unknown>): TabspotObserverOptions {
  rejectUnknownKeys(raw, OBSERVER_KEYS, "observer");
  return { name: nonEmptyString(raw.name, "observer.name") };
}

/** Validates an already-parsed config object. Throws on any structural issue. */
export function validateNodeOptions(parsed: unknown): TabspotNodeOptions {
  if (!isPlainObject(parsed)) throw new Error("Tabspot config must be a JSON object");
  for (const key of Object.keys(parsed)) {
    if (!NODE_SECTIONS.has(key)) {
      throw new Error(`Unknown section "${key}" (allowed: root, mover, grouper, observer)`);
    }
  }
  const out: TabspotNodeOptions = {};
  if (parsed.root !== undefined) {
    if (!isPlainObject(parsed.root)) throw new Error(`"root" must be an object`);
    out.root = validateRoot(parsed.root);
  }
  if (parsed.mover !== undefined) {
    if (!isPlainObject(parsed.mover)) throw new Error(`"mover" must be an object`);
    out.mover = validateMover(parsed.mover);
  }
  if (parsed.grouper !== undefined) {
    if (!isPlainObject(parsed.grouper)) throw new Error(`"grouper" must be an object`);
    out.grouper = validateGrouper(parsed.grouper);
  }
  if (parsed.observer !== undefined) {
    if (!isPlainObject(parsed.observer)) throw new Error(`"observer" must be an object`);
    out.observer = validateObserver(parsed.observer);
  }
  if (out.root && out.grouper) {
    throw new Error(`"root" and "grouper" cannot coexist on the same element`);
  }
  return out;
}

/** Strict JSON parser. Returns null + logs on any failure. */
export function parseTabspotAttribute(
  raw: string | null,
  element?: HTMLElement,
): TabspotNodeOptions | null {
  if (raw === null || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tabspot] invalid JSON in data-tabspot: ${msg}`, { raw, element });
    return null;
  }
  try {
    return validateNodeOptions(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tabspot] invalid data-tabspot config: ${msg}`, { raw, element });
    return null;
  }
}

export function serializeTabspotConfig(config: TabspotNodeOptions): string {
  // validateNodeOptions throws on bad config; serialize only validated objects.
  const validated = validateNodeOptions(config);
  return JSON.stringify(validated);
}

export function readTabspotConfig(element: HTMLElement): TabspotNodeOptions | null {
  return parseTabspotAttribute(element.getAttribute(TABSPOT_ATTR), element);
}
