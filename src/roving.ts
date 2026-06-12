/**
 * Roving tabindex manager.
 *
 * For a roving root, exactly one item carries `tabindex="0"` (the tab stop) and
 * the rest `tabindex="-1"`, so `Tab` treats the whole widget as a single stop
 * while arrows navigate within it. The tab stop follows focus.
 *
 * Tabspot owns the `tabindex` of managed items while roving is on, snapshots the
 * author's original value, and restores it on unregister/destroy. The observer
 * ignores `tabindex` mutations on managed elements (see `isManaged`) so these
 * writes never trigger a rebuild.
 */

interface RovingState {
  items: Set<HTMLElement>;
  tabStop: HTMLElement | null;
}

export class RovingManager {
  private original = new WeakMap<HTMLElement, string | null>();
  private managed = new Set<HTMLElement>();
  private roots = new Map<HTMLElement, RovingState>();

  /** True if `el` is currently a roving-managed item of any root. */
  isManaged(el: HTMLElement): boolean {
    return this.managed.has(el);
  }

  private snapshot(el: HTMLElement): void {
    if (!this.original.has(el)) this.original.set(el, el.getAttribute("tabindex"));
  }

  private setTab(el: HTMLElement, value: "0" | "-1"): void {
    if (el.getAttribute("tabindex") !== value) el.setAttribute("tabindex", value);
  }

  private restore(el: HTMLElement): void {
    const orig = this.original.get(el);
    if (orig === undefined) return;
    if (orig === null) el.removeAttribute("tabindex");
    else el.setAttribute("tabindex", orig);
    this.original.delete(el);
  }

  /**
   * (Re)apply roving over `items` for `root`. The tab stop is, in order of
   * preference: `preferred` (if a managed item), the previous tab stop (if still
   * present), else the first item.
   */
  apply(root: HTMLElement, items: HTMLElement[], preferred: HTMLElement | null): void {
    const prev = this.roots.get(root);
    if (prev) for (const el of prev.items) this.managed.delete(el);

    const set = new Set(items);
    let stop: HTMLElement | null = null;
    if (preferred && set.has(preferred)) stop = preferred;
    else if (prev?.tabStop && set.has(prev.tabStop)) stop = prev.tabStop;
    else stop = items[0] ?? null;

    for (const el of items) {
      this.snapshot(el);
      this.managed.add(el);
      this.setTab(el, el === stop ? "0" : "-1");
    }
    this.roots.set(root, { items: set, tabStop: stop });
  }

  /** Migrate the tab stop of `root` to `to` (a managed item). No-op otherwise. */
  migrate(root: HTMLElement, to: HTMLElement): void {
    const st = this.roots.get(root);
    if (!st || !st.items.has(to) || st.tabStop === to) return;
    if (st.tabStop && st.items.has(st.tabStop)) this.setTab(st.tabStop, "-1");
    this.setTab(to, "0");
    st.tabStop = to;
  }

  /** Stop managing `root`, restoring each item's original tabindex. */
  unregister(root: HTMLElement): void {
    const st = this.roots.get(root);
    if (!st) return;
    for (const el of st.items) {
      this.restore(el);
      this.managed.delete(el);
    }
    this.roots.delete(root);
  }

  /** Restore every managed root (used by engine destroy). */
  destroyAll(): void {
    // Copy keys: unregister() mutates `this.roots` during iteration.
    for (const root of Array.from(this.roots.keys())) this.unregister(root);
  }
}
