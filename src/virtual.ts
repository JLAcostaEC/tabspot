/**
 * Virtualization support.
 *
 * Tabspot navigates the DOM, not a data model: in a windowed list only the
 * rendered slice exists. The bridge is declarative (real index + total as
 * attributes) + imperative (a `scrollToIndex` adapter registered at runtime).
 *
 * `tabspotVirtual(el, adapter)` is keyed by element (no instance): the adapter
 * is looked up lazily by the engine at navigation time, so registration order
 * and which engine owns the root don't matter.
 */

export interface VirtualAdapter {
  /** Scroll so the row/option with this real index renders. May be async. */
  scrollToIndex(index: number): void | Promise<void>;
  /** Total real item count. Falls back to aria-setsize/aria-rowcount. */
  count?(): number;
}

/** What a boundary-crossing navigation is trying to reach, by real index. */
export type VirtualTarget =
  | { kind: "linear"; index: number }
  | { kind: "grid"; row: number; col: number };

const adapters = new WeakMap<HTMLElement, VirtualAdapter>();

/** Register a virtualization adapter for a root element. Returns a detach fn. */
export function tabspotVirtual(el: HTMLElement, adapter: VirtualAdapter): () => void {
  adapters.set(el, adapter);
  return () => {
    if (adapters.get(el) === adapter) adapters.delete(el);
  };
}

export function getVirtualAdapter(el: HTMLElement): VirtualAdapter | null {
  return adapters.get(el) ?? null;
}

function intOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * The real (model) index of an item: its own (or nearest ancestor's)
 * `data-index` (0-based), else `aria-posinset`/`aria-rowindex` (1-based).
 * The ancestor lookup lets a cell inherit its row's index.
 */
export function realIndex(el: HTMLElement): number | null {
  const di = el.closest("[data-index]");
  if (di) {
    const n = intOrNull(di.getAttribute("data-index"));
    if (n !== null) return n;
  }
  const ps = el.closest("[aria-posinset]");
  if (ps) {
    const n = intOrNull(ps.getAttribute("aria-posinset"));
    if (n !== null) return n - 1;
  }
  const ri = el.closest("[aria-rowindex]");
  if (ri) {
    const n = intOrNull(ri.getAttribute("aria-rowindex"));
    if (n !== null) return n - 1;
  }
  return null;
}

/** Total real item count (adapter.count → aria-setsize → aria-rowcount). */
export function totalCount(rootEl: HTMLElement, adapter: VirtualAdapter): number | null {
  if (adapter.count) {
    const n = adapter.count();
    return Number.isFinite(n) ? n : null;
  }
  return (
    intOrNull(rootEl.getAttribute("aria-setsize")) ??
    intOrNull(rootEl.getAttribute("aria-rowcount"))
  );
}

/** Locate the rendered element for a virtual target, or null if not present. */
export function findVirtualTarget(rootEl: HTMLElement, target: VirtualTarget): HTMLElement | null {
  if (target.kind === "linear") {
    const el = rootEl.querySelector(`[data-index="${target.index}"]`);
    return el instanceof HTMLElement ? el : null;
  }
  const row = rootEl.querySelector(`[data-index="${target.row}"]`);
  const cell = row?.querySelector(`[data-colindex="${target.col}"]`);
  return cell instanceof HTMLElement ? cell : null;
}

/** Resolve once `[data-index=dataIndex]` exists under `rootEl` (with timeout). */
export function waitForRendered(
  rootEl: HTMLElement,
  dataIndex: number,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const sel = `[data-index="${dataIndex}"]`;
  const present = rootEl.querySelector(sel);
  if (present instanceof HTMLElement) return Promise.resolve(present);
  return new Promise((resolve) => {
    let done = false;
    const finish = (el: HTMLElement | null) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(el);
    };
    const obs = new MutationObserver(() => {
      const el = rootEl.querySelector(sel);
      if (el instanceof HTMLElement) finish(el);
    });
    obs.observe(rootEl, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}
