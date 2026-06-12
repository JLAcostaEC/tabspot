import type { Engine } from "./core.ts";
import { setTabspotAttributes } from "./attributes.ts";
import { TABSPOT_ATTR } from "./parser.ts";
import type { TabspotObserverAPI, TabspotObserverRegistration } from "./types.ts";

interface Pending {
  registration: TabspotObserverRegistration;
  ref: WeakRef<HTMLElement> | null;
}

/**
 * Watches the document for relevant attribute/DOM changes and marks roots dirty.
 * Also drives the `tabspotObserver` pending-target queue.
 */
export class DomReactor {
  private observer: MutationObserver;
  private pending = new Map<string, Pending>();

  constructor(private engine: Engine) {
    this.observer = new MutationObserver((records) => this.onMutations(records));
  }

  start(): void {
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [TABSPOT_ATTR, "tabindex", "disabled", "hidden", "aria-hidden"],
    });
  }

  stop(): void {
    this.observer.disconnect();
    this.pending.clear();
  }

  api(): TabspotObserverAPI {
    return {
      observe: (registration) => this.register(registration),
      disconnect: (name) => {
        this.pending.delete(name);
      },
    };
  }

  private register(registration: TabspotObserverRegistration): void {
    const match = document.querySelector(registration.selector);
    if (match instanceof HTMLElement) {
      const applied = setTabspotAttributes({
        element: match,
        config: registration.config,
        merge: true,
      });
      // Only retain the WeakRef when the attributes were actually applied;
      // otherwise keep the entry queued so a later mutation can retry.
      this.pending.set(registration.name, {
        registration,
        ref: applied.ok ? new WeakRef(match) : null,
      });
      return;
    }
    this.pending.set(registration.name, { registration, ref: null });
  }

  private onMutations(records: MutationRecord[]): void {
    // Deduplicate per root within a single mutation batch: each root is marked
    // dirty at most once, regardless of how many records target it.
    const dirtyRoots = new Set<HTMLElement>();
    const addedHosts: HTMLElement[] = [];
    const removedRoots = new Set<HTMLElement>();

    const flag = (n: Node) => {
      if (!(n instanceof HTMLElement)) return;
      for (const root of this.engine.rootElements()) {
        if (dirtyRoots.has(root)) continue;
        if (root === n || root.contains(n)) dirtyRoots.add(root);
      }
    };

    // A removed node that is (or contains) a registered root which is no longer
    // connected: the root is gone for good — unregister it (don't leak it).
    const checkRemovedRoot = (n: Node) => {
      if (!(n instanceof HTMLElement)) return;
      for (const root of this.engine.rootElements()) {
        if ((root === n || n.contains(root)) && !root.isConnected) removedRoots.add(root);
      }
    };

    for (const rec of records) {
      if (rec.type === "attributes") {
        // Tabspot's own roving tabindex writes must not trigger a rebuild: they
        // never change the tree structure, only which item is the tab stop.
        if (
          rec.attributeName === "tabindex" &&
          rec.target instanceof HTMLElement &&
          this.engine.isRovingManaged(rec.target)
        ) {
          continue;
        }
        flag(rec.target);
      } else if (rec.type === "childList") {
        rec.addedNodes.forEach((n) => {
          flag(n);
          if (n instanceof HTMLElement) addedHosts.push(n);
        });
        rec.removedNodes.forEach((n) => {
          flag(n);
          checkRemovedRoot(n);
        });
      }
    }

    for (const root of removedRoots) this.engine.unregisterRoot(root);
    for (const root of dirtyRoots) {
      if (!removedRoots.has(root)) this.engine.markRootDirty(root);
    }
    for (const host of addedHosts) this.tryMatchPending(host);

    if (dirtyRoots.size > 0 || addedHosts.length > 0) {
      this.engine.logger.full("mutations processed", {
        records: records.length,
        dirtyRoots: dirtyRoots.size,
      });
    }
  }

  private tryMatchPending(added: HTMLElement): void {
    if (this.pending.size === 0) return;
    for (const [, entry] of this.pending) {
      if (entry.ref?.deref()) continue;
      const match = added.matches(entry.registration.selector)
        ? added
        : added.querySelector(entry.registration.selector);
      if (match instanceof HTMLElement) {
        const applied = setTabspotAttributes({
          element: match,
          config: entry.registration.config,
          merge: true,
        });
        if (applied.ok) entry.ref = new WeakRef(match);
      }
    }
  }
}
