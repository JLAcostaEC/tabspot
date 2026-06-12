import { getEngine } from "./core.ts";
import { createLogger } from "./debug.ts";
import {
  parseTabspotAttribute,
  serializeTabspotConfig,
  TABSPOT_ATTR,
  validateNodeOptions,
} from "./parser.ts";
import type {
  SetAttributesArgs,
  SetAttributesResult,
  TabspotInstance,
  TabspotNodeOptions,
} from "./types.ts";

const fallbackLogger = createLogger();

/**
 * Build the serialized `data-tabspot` attribute for a given config without
 * touching the DOM. Useful for SSR / pre-render scenarios where the consumer
 * spreads the result on an element before it is mounted.
 *
 * Returns `null` when the config is invalid (and logs the reason).
 */
export function getTabspotAttributes(config: TabspotNodeOptions): Record<string, string> | null {
  let validated: TabspotNodeOptions;
  try {
    validated = validateNodeOptions(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fallbackLogger.error(`getTabspotAttributes: invalid config: ${msg}`, { config });
    return null;
  }
  return { [TABSPOT_ATTR]: JSON.stringify(validated) };
}

/**
 * Writes (or merges) `data-tabspot` on the element.
 *
 * Returns a discriminated result: `{ ok: true, instance }` (the engine instance,
 * or `null` if no engine is running yet — the attribute is still written), or
 * `{ ok: false, reason, message }` when validation fails or a root would nest
 * inside another root (in which case the DOM is not mutated).
 */
export function setTabspotAttributes(args: SetAttributesArgs): SetAttributesResult {
  const { element, config, merge = false } = args;
  const engine = getEngine();
  const logger = engine?.logger ?? fallbackLogger;

  let next: TabspotNodeOptions;
  try {
    next = validateNodeOptions(config);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`setTabspotAttributes: invalid config: ${message}`, { config });
    return { ok: false, reason: "invalid", message };
  }

  if (merge) {
    const current = parseTabspotAttribute(element.getAttribute(TABSPOT_ATTR), element) ?? {};
    next = mergeConfigs(current, next);
    try {
      next = validateNodeOptions(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`setTabspotAttributes: merged config invalid: ${message}`, { merged: next });
      return { ok: false, reason: "invalid", message };
    }
  }

  if (next.root) {
    const ancestorRoot = findAncestorRoot(element);
    if (ancestorRoot) {
      const message = "cannot nest a root inside another root";
      logger.warn(`setTabspotAttributes: ${message}; ignoring`, { element, ancestorRoot });
      return { ok: false, reason: "nested-root", message };
    }
  }

  let serialized: string;
  try {
    serialized = serializeTabspotConfig(next);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`setTabspotAttributes: serialization failed: ${message}`);
    return { ok: false, reason: "invalid", message };
  }

  element.setAttribute(TABSPOT_ATTR, serialized);
  if (engine) {
    if (next.root) {
      engine.registerRoot(element, next.root);
    } else {
      // If this element WAS a root and the new config removes that section,
      // unregister it. Otherwise just invalidate so the containing root rebuilds.
      if (engine.hasRoot(element)) engine.unregisterRoot(element);
      engine.invalidate(element);
    }
  }

  return { ok: true, instance: engine?.instance ?? null };
}

/** Apply several `setTabspotAttributes` calls; returns a result per entry. */
export function setTabspotAttributesBatch(
  items: readonly SetAttributesArgs[],
): SetAttributesResult[] {
  return items.map((item) => setTabspotAttributes(item));
}

/**
 * Remove one section from an element's `data-tabspot` (merge can't clear a
 * section). Re-registers/invalidates via the engine like `setTabspotAttributes`.
 */
export function unsetTabspotSection(
  element: HTMLElement,
  section: keyof TabspotNodeOptions,
): SetAttributesResult {
  const current = parseTabspotAttribute(element.getAttribute(TABSPOT_ATTR), element) ?? {};
  const next: TabspotNodeOptions = { ...current };
  delete next[section];
  // merge:false replaces the whole attribute with `next` (sans the section).
  // Dropping `root` triggers unregisterRoot inside setTabspotAttributes.
  return setTabspotAttributes({ element, config: next, merge: false });
}

function mergeConfigs(a: TabspotNodeOptions, b: TabspotNodeOptions): TabspotNodeOptions {
  return {
    root: b.root ? { ...a.root, ...b.root } : a.root,
    mover: b.mover ? { ...a.mover, ...b.mover } : a.mover,
    grouper: b.grouper ? { ...a.grouper, ...b.grouper } : a.grouper,
    observer: b.observer ? { ...a.observer, ...b.observer } : a.observer,
  };
}

function findAncestorRoot(element: HTMLElement): HTMLElement | null {
  // Fast path: when an engine is running, ask it directly.
  const engine = getEngine();
  if (engine) {
    let cur: HTMLElement | null = element.parentElement;
    while (cur) {
      if (engine.hasRoot(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  // Pre-engine fallback: parse attributes up the tree.
  let cur: HTMLElement | null = element.parentElement;
  while (cur) {
    const cfg = parseTabspotAttribute(cur.getAttribute(TABSPOT_ATTR));
    if (cfg?.root) return cur;
    cur = cur.parentElement;
  }
  return null;
}
