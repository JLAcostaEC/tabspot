import { ActivationManager } from "./activation.ts";
import { createLogger, type Logger } from "./debug.ts";
import {
  type BoundaryWalk,
  commitVirtual,
  emitEdge,
  handleKeydown,
  isNodeSkipped,
  keyToDirection,
  type NavigationDeps,
  resolveBoundaryWalk,
  virtualHandlesBoundary,
} from "./navigation.ts";
import { DomReactor } from "./observer.ts";
import { readTabspotConfig, TABSPOT_ATTR } from "./parser.ts";
import { RovingManager } from "./roving.ts";
import { buildRootTree, type CompiledRoot, type FocusableNode } from "./tree.ts";
import {
  findVirtualTarget,
  getVirtualAdapter,
  totalCount,
  type VirtualTarget,
  virtualTargetIndex,
  waitForRendered,
} from "./virtual.ts";
import type {
  EnterExitDirections,
  TabspotEventListener,
  TabspotInstance,
  TabspotNavigationEvent,
  TabspotObserverAPI,
  TabspotOptions,
  TabspotRootOptions,
} from "./types.ts";

export interface Engine {
  instance: TabspotInstance;
  logger: Logger;
  registerRoot(el: HTMLElement, opts: TabspotRootOptions): void;
  unregisterRoot(el: HTMLElement): void;
  hasRoot(el: HTMLElement): boolean;
  /** Iterate over all registered root elements. */
  rootElements(): IterableIterator<HTMLElement>;
  /** Fast lookup: nearest registered root that contains `target`, or null. */
  containingRoot(target: Node): HTMLElement | null;
  /** Mark any registered root whose subtree contains `el` as dirty. */
  invalidate(el: HTMLElement): void;
  /** Mark a specific root as dirty (used by the reactor after batch dedupe). */
  markRootDirty(rootEl: HTMLElement): void;
  /** True if `el`'s tabindex is currently managed by roving (observer ignores it). */
  isRovingManaged(el: HTMLElement): boolean;
  /** Empty the cursor of a registered non-`focus` root. False if not applicable. */
  clearActive(el: HTMLElement): boolean;
  observerApi(): TabspotObserverAPI;
}

/**
 * Hops one virtual boundary crossing may take before it gives up and reports an
 * edge. Every hop is a scroll + render round trip (up to a 1s timeout each), so
 * an unbounded walk over a long run of non-landable rows would hang the widget
 * on a single keystroke. Runs this long are pathological: a `total` overshooting
 * the real data, or a list that is unlandable end to end.
 */
const MAX_BOUNDARY_HOPS = 32;

/** An additive navigation subscriber; `root` null means "every root". */
interface Subscriber {
  root: HTMLElement | null;
  fn: TabspotEventListener;
}

interface EngineState {
  options: TabspotOptions;
  /** The single `options.onNavigate` slot; see `subscribers` for the additive ones. */
  listener: TabspotEventListener | undefined;
  subscribers: Set<Subscriber>;
  logger: Logger;
  roots: Map<HTMLElement, CompiledRoot>;
  reactor: DomReactor;
  onKeydown: (ev: KeyboardEvent) => void;
  onFocusIn: (ev: FocusEvent) => void;
}

let singleton: { engine: Engine; state: EngineState } | null = null;

export function getEngine(): Engine | null {
  return singleton?.engine ?? null;
}

export function tabspot(options: TabspotOptions = {}): TabspotInstance {
  if (singleton) {
    singleton.engine.instance.update(options);
    return singleton.engine.instance;
  }

  // Browser-only. Fail loud (don't silently no-op) so the misuse surfaces; the
  // SSR seam is getTabspotAttributes() + calling tabspot() in a client effect.
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    throw new Error(
      "[tabspot] tabspot() is browser-only. Call it from a client-side effect " +
        "(useEffect/onMounted/…); for server markup use getTabspotAttributes().",
    );
  }

  const logger = createLogger(options.debug, options.logger);
  const rovingManager = new RovingManager();
  const activationManager = new ActivationManager();
  // Maps a root to its activation controller (for routing keydown that fires on
  // an activedescendant controller living outside the root subtree).
  const controllers = new Map<HTMLElement, HTMLElement>();

  // Build a root's tree and apply the activation effect: roving tabindex for
  // `focus`, or an initial active item + marker for the other modes.
  function compileRoot(rootEl: HTMLElement): CompiledRoot | null {
    const compiled = buildRootTree(rootEl);
    if (!compiled) return null;
    // Build diagnostics: shown when the global debug OR this root's own debug is
    // on (root.debug scopes diagnostics to a single widget).
    if (compiled.warnings.length > 0 && (logger.level || compiled.root.opts.debug)) {
      for (const w of compiled.warnings) logger.warn(w);
    }
    if (compiled.activation.mode === "focus") {
      activationManager.unregister(rootEl);
      controllers.delete(rootEl);
      if (compiled.roving) {
        const focused =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // Skipped items stay managed (so `Tab` passes them by) but can never
        // hold the tab stop.
        const skipped = new Set<HTMLElement>();
        for (const f of compiled.focusables) if (isNodeSkipped(f)) skipped.add(f.el);
        rovingManager.apply(
          rootEl,
          compiled.focusables.map((f) => f.el),
          focused,
          skipped,
        );
      } else {
        rovingManager.unregister(rootEl);
      }
    } else {
      // Non-focus activation: record the controller so keydown on it routes
      // here. The cursor stays EMPTY until the user navigates — registering a
      // root must not publish `aria-activedescendant` or a mark on its own
      // (the first arrow / Home / End enters the list, see `handleEntry`).
      rovingManager.unregister(rootEl);
      if (compiled.activation.controller) {
        controllers.set(rootEl, compiled.activation.controller);
      } else {
        controllers.delete(rootEl);
      }
      // Drop a cursor left on an item this build no longer knows (removed from
      // the DOM, or no longer matched by `items`), clearing its marker with it.
      const active = activationManager.getActive(rootEl);
      if (active && !compiled.byElement.has(active)) {
        activationManager.setActive(rootEl, compiled.activation, null);
      }
    }
    return compiled;
  }

  // Fan a navigation event out to the `onNavigate` slot and every subscriber
  // interested in this root. The event object is shared, so a `preventDefault()`
  // from any of them cancels the move for all.
  function notify(ev: TabspotNavigationEvent): void {
    state.listener?.(ev);
    // Copy: a subscriber may detach itself while being notified.
    for (const sub of Array.from(state.subscribers)) {
      if (sub.root === null || sub.root === ev.root) sub.fn(ev);
    }
  }

  // Build the activation-aware navigation deps for a root.
  function makeDeps(rootEl: HTMLElement, compiled: CompiledRoot): NavigationDeps {
    return {
      compiled,
      listener: notify,
      resolveCurrent: (target) => {
        if (compiled.activation.mode === "focus") return compiled.byElement.get(target) ?? null;
        // No fallback to the first item: an empty cursor stays empty, so the
        // next key enters the root instead of moving off an implied position.
        const active = activationManager.getActive(rootEl);
        return active ? (compiled.byElement.get(active) ?? null) : null;
      },
      applyMove: (_from, to) => {
        if (compiled.activation.mode === "focus") to.el.focus();
        else activationManager.setActive(rootEl, compiled.activation, to.el);
      },
    };
  }

  // Resolve the root that owns a keydown: the root containing the target, or the
  // root whose (external) activation controller is the target.
  function rootForTarget(target: HTMLElement): HTMLElement | null {
    const inside = engine.containingRoot(target);
    if (inside) return inside;
    for (const [rootEl, ctrl] of controllers) if (ctrl === target) return rootEl;
    return null;
  }

  // Token of the walk that currently owns each root's virtual boundary crossing
  // (coalesces held-down arrows). It identifies the WALK, not the target index:
  // a walk takes several hops and each hop changes the target, so keying on the
  // index would make a multi-hop walk mistake its own next hop for a newer
  // request and cancel itself.
  const pendingVirtual = new Map<HTMLElement, number>();
  let lastWalkToken = 0;

  // A move clamped at the rendered edge of a virtual root: if there's a real
  // index beyond, walk to the first landable row there (scrolling and waiting
  // for each hop to render) and activate it — or report the edge.
  function tryVirtual(rootEl: HTMLElement, compiled: CompiledRoot, ev: KeyboardEvent): void {
    const adapter = getVirtualAdapter(rootEl);
    if (!adapter) return;
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const deps = makeDeps(rootEl, compiled);
    const current = deps.resolveCurrent(target);
    if (!current) return;
    const total = totalCount(rootEl, adapter);
    // resolveBoundaryWalk clamps/wraps against `total`: out-of-range non-cyclic
    // edges return null; cyclic edges wrap to the opposite real end. It hands
    // back a WALK, because the row one index over may not be landable.
    const walk = resolveBoundaryWalk(current, compiled, ev.key, total);
    const dir = keyToDirection(ev.key);
    if (!walk) {
      // `resolveBoundaryWalk` returns null for several reasons, and only one
      // of them is an edge: the real first/last item. Gate on the very predicate
      // navigation used to defer to us, so a cross-axis key reports nothing and
      // a boundary navigation already reported is not reported twice.
      if (dir && virtualHandlesBoundary(current, compiled, dir)) {
        if (emitEdge(deps, current, dir, ev.key)) ev.preventDefault();
      }
      return;
    }
    if (!dir) return;
    ev.preventDefault();
    const token = ++lastWalkToken;
    pendingVirtual.set(rootEl, token);
    void walkVirtual(rootEl, walk, current, dir, token);
  }

  /**
   * Walk a virtualized boundary crossing to the first row a move may rest on.
   *
   * Every hop is a full round trip — scroll, wait for the row to render, rebuild
   * — because the next index can be outside the rendered window too. A hop that
   * resolves onto a row the item list does not accept (excluded by `items`) or
   * that the mover `skip`s continues in the same direction, so the cursor never
   * rests on one, not even transiently.
   *
   * The walk always ENDS IN AN EVENT: it commits the move, or reports `atEdge`
   * once nothing landable is left. Ending silently is the bug this replaces —
   * `tryVirtual` already claimed the keystroke with `preventDefault`, so a quiet
   * return strands the cursor with no event to react to and no native scroll
   * either. The one exception is being superseded by a newer keystroke, which
   * reports on its own behalf.
   */
  async function walkVirtual(
    rootEl: HTMLElement,
    walk: BoundaryWalk,
    origin: FocusableNode,
    dir: EnterExitDirections,
    token: number,
  ): Promise<void> {
    const adapter = getVirtualAdapter(rootEl);
    if (!adapter) return;
    let vt: VirtualTarget | null = walk.target;
    let hop = 0;

    // Each hop must finish before the next begins: where to look next is only
    // known once this row has rendered. Sequential by nature, not parallelisable.
    /* oxlint-disable no-await-in-loop */
    for (; hop < MAX_BOUNDARY_HOPS; hop++) {
      if (!vt) break; // the index left the range: the real edge
      const idx = virtualTargetIndex(vt);
      // A cyclic walk that arrives back where it started has been all the way
      // around without finding a landable row. A circular index space never
      // leaves the range, so this is the only thing that ends it.
      if (idx === walk.origin) break;

      try {
        await adapter.scrollToIndex(idx);
      } catch {
        break;
      }
      if (pendingVirtual.get(rootEl) !== token) return; // superseded by a newer key
      // Bind `tick` to correctly handle any `this` inside the adapter implementation
      const rendered = await waitForRendered(rootEl, idx, 1000, adapter.tick?.bind(adapter));
      if (pendingVirtual.get(rootEl) !== token) return;
      // The adapter cannot produce this row — a `total` overshooting the real
      // data (a stale `aria-setsize`), or a window that will not move. Insisting
      // costs a full timeout per hop for rows that will never arrive, so an
      // unrenderable row is the end of the list.
      if (!rendered) break;

      const compiled = compileRoot(rootEl);
      if (!compiled) return;
      state.roots.set(rootEl, compiled);
      const targetEl = findVirtualTarget(rootEl, vt);
      const to = targetEl ? compiled.byElement.get(targetEl) : undefined;
      if (to && !isNodeSkipped(to)) {
        pendingVirtual.delete(rootEl);
        // The origin row may have unmounted while the list scrolled; it only
        // feeds the event payload, so a missing one must not drop the move.
        const from = compiled.byElement.get(origin.el) ?? null;
        commitVirtual(makeDeps(rootEl, compiled), from, to, dir);
        return;
      }
      vt = walk.step(vt); // not landable — keep going in the same direction
    }
    /* oxlint-enable no-await-in-loop */

    if (pendingVirtual.get(rootEl) !== token) return;
    pendingVirtual.delete(rootEl);
    if (hop >= MAX_BOUNDARY_HOPS) {
      logger.warn(
        `virtual boundary walk gave up after ${MAX_BOUNDARY_HOPS} hops without a landable ` +
          "row; reporting an edge. Check that `total` matches the data and that the run of " +
          "non-item / skipped rows is intentional",
        { rootEl, from: origin.el, direction: dir },
      );
    }
    reportVirtualEdge(rootEl, origin, dir);
  }

  /**
   * Report the edge a virtual walk ended on. Reads the freshest tree so the
   * event carries a correct `fromIndex`, falling back to the pre-walk node when
   * the origin row unmounted while the list scrolled — an edge the consumer
   * never hears is exactly what stranded the cursor before.
   */
  function reportVirtualEdge(
    rootEl: HTMLElement,
    origin: FocusableNode,
    dir: EnterExitDirections,
  ): void {
    const compiled = state.roots.get(rootEl);
    if (!compiled) return;
    const from = compiled.byElement.get(origin.el) ?? origin;
    // No raw key: the walk outlived the keystroke, same as `commitVirtual`.
    emitEdge(makeDeps(rootEl, compiled), from, dir, "");
  }

  const state: EngineState = {
    options,
    listener: options.onNavigate,
    subscribers: new Set(),
    logger,
    roots: new Map(),
    reactor: undefined as unknown as DomReactor,
    onKeydown: undefined as unknown as (ev: KeyboardEvent) => void,
    onFocusIn: undefined as unknown as (ev: FocusEvent) => void,
  };

  const engine: Engine = {
    instance: undefined as unknown as TabspotInstance,
    logger,
    registerRoot(el, opts) {
      // Ensure tree exists / refreshed for this root.
      const compiled = compileRoot(el);
      if (!compiled) {
        logger.warn("registerRoot: element has no valid root config", { el });
        return;
      }
      state.roots.set(el, compiled);
      logger.basic("root registered", { el, opts });
    },
    unregisterRoot(el) {
      state.roots.delete(el);
      rovingManager.unregister(el);
      activationManager.unregister(el);
      controllers.delete(el);
    },
    hasRoot: (el) => state.roots.has(el),
    rootElements: () => state.roots.keys(),
    containingRoot(target) {
      for (const rootEl of state.roots.keys()) {
        if (rootEl === target || rootEl.contains(target)) return rootEl;
      }
      return null;
    },
    invalidate(el) {
      for (const [rootEl, compiled] of state.roots) {
        if (rootEl === el || rootEl.contains(el)) {
          compiled.dirty = true;
          logger.full("root marked dirty", { rootEl });
        }
      }
    },
    markRootDirty(rootEl) {
      const compiled = state.roots.get(rootEl);
      if (compiled) {
        compiled.dirty = true;
        logger.full("root marked dirty (batched)", { rootEl });
      }
    },
    isRovingManaged: (el) => rovingManager.isManaged(el),
    clearActive(el) {
      const compiled = state.roots.get(el);
      if (!compiled || compiled.activation.mode === "focus") return false;
      activationManager.setActive(el, compiled.activation, null);
      logger.full("active cleared", { el });
      return true;
    },
    observerApi: () => state.reactor.api(),
  };

  const instance: TabspotInstance = {
    rebuild(rootEl) {
      if (rootEl) {
        const compiled = compileRoot(rootEl);
        if (compiled) state.roots.set(rootEl, compiled);
        return;
      }
      for (const el of state.roots.keys()) {
        const compiled = compileRoot(el);
        if (compiled) state.roots.set(el, compiled);
      }
      logger.basic("rebuild complete");
    },
    update(next) {
      Object.assign(state.options, next);
      if (next.debug !== undefined) state.logger.level = next.debug;
      if ("onNavigate" in next) state.listener = next.onNavigate;
    },
    subscribe(
      rootOrListener: HTMLElement | TabspotEventListener,
      maybeListener?: TabspotEventListener,
    ): () => void {
      const sub: Subscriber =
        typeof rootOrListener === "function"
          ? { root: null, fn: rootOrListener }
          : { root: rootOrListener, fn: maybeListener as TabspotEventListener };
      state.subscribers.add(sub);
      logger.full("navigation subscriber added", { root: sub.root });
      return () => {
        state.subscribers.delete(sub);
      };
    },
    destroy() {
      document.removeEventListener("keydown", state.onKeydown, true);
      document.removeEventListener("focusin", state.onFocusIn, true);
      state.reactor.stop();
      rovingManager.destroyAll();
      activationManager.destroyAll();
      controllers.clear();
      pendingVirtual.clear();
      state.roots.clear();
      state.listener = undefined;
      state.subscribers.clear();
      logger.basic("destroyed");
      singleton = null;
    },
  };
  engine.instance = instance;

  // Lazy: rebuild any dirty root before handling input.
  state.onKeydown = (ev: KeyboardEvent) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const rootEl = rootForTarget(target);
    if (!rootEl) return;
    let compiled = state.roots.get(rootEl);
    if (!compiled || compiled.dirty) {
      const next = compileRoot(rootEl);
      if (!next) return;
      state.roots.set(rootEl, next);
      compiled = next;
    }
    // A non-`focus` root takes keys ONLY from its activation controller (the
    // root element itself for `marked`/`controlled`). Without this, a key
    // pressed in any descendant that owns its arrows would drive the list
    // on top of its own action. Also covers the virtual path below.
    if (compiled.activation.mode !== "focus" && target !== compiled.activation.controller) {
      logger.full("keydown ignored: target is not the activation controller", { target, rootEl });
      return;
    }
    const handled = handleKeydown(ev, makeDeps(rootEl, compiled));
    if (handled) {
      ev.preventDefault();
      return;
    }
    // The move clamped — maybe it's the edge of a virtual list.
    tryVirtual(rootEl, compiled, ev);
  };

  // Focusin: if focus lands on an element the tree doesn't know about yet
  // (e.g. inserted after the previous rebuild), pro-actively rebuild the root
  // so the next keystroke navigates correctly.
  state.onFocusIn = (ev: FocusEvent) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const rootEl = engine.containingRoot(target);
    if (!rootEl) return;
    let compiled = state.roots.get(rootEl);
    if (!compiled) return;
    if (compiled.dirty || !compiled.byElement.has(target)) {
      const next = compileRoot(rootEl);
      if (next) {
        state.roots.set(rootEl, next);
        compiled = next;
      }
    }
    // Roving: the focused element becomes the single tab stop (covers mouse /
    // programmatic focus as well as keyboard moves, which focus() through here).
    if (compiled.roving) rovingManager.migrate(rootEl, target);
  };

  document.addEventListener("keydown", state.onKeydown, true);
  document.addEventListener("focusin", state.onFocusIn, true);

  state.reactor = new DomReactor(engine);
  state.reactor.start();

  // Pick up any roots already in the DOM declared via data-tabspot { root: ... }.
  // Skip roots nested inside another already-registered root (a node can only
  // belong to a single root).
  document.querySelectorAll<HTMLElement>(`[${TABSPOT_ATTR}]`).forEach((el) => {
    const cfg = readTabspotConfig(el);
    if (!cfg?.root) return;
    let ancestor: HTMLElement | null = el.parentElement;
    let nested = false;
    while (ancestor) {
      if (state.roots.has(ancestor)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nested) {
      logger.warn("bootstrap: skipping root nested inside another root", { el });
      return;
    }
    const compiled = compileRoot(el);
    if (compiled) state.roots.set(el, compiled);
  });

  singleton = { engine, state };
  logger.basic("engine started", { options });
  return instance;
}

/**
 * Empty the cursor ("active item") of a non-`focus` root: removes the mark and
 * the controller's `aria-activedescendant`, without unregistering anything.
 *
 * The root keeps working — the next arrow (or `Home`/`End`) enters it from
 * outside again: forward keys land on the first item, backward keys on the
 * last. Useful when the widget closes or its query changes and no suggestion
 * should read as chosen.
 *
 * Returns false when `root` is not a registered root or uses `focus`
 * activation, where the cursor is DOM focus and Tabspot does not own it.
 */
export function clearTabspotActive(root: HTMLElement): boolean {
  return getEngine()?.clearActive(root) ?? false;
}

export function tabspotObserver(instance: TabspotInstance): TabspotObserverAPI {
  if (!singleton || singleton.engine.instance !== instance) {
    throw new Error("[tabspot] tabspotObserver: instance is not active");
  }
  return singleton.engine.observerApi();
}
