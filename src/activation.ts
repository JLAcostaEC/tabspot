/**
 * Activation manager for non-`focus` movers.
 *
 * Tracks the "active" item per root (the logical cursor, since DOM focus does
 * not move) and applies the mode's mark on a move:
 * - `activedescendant`: set `aria-activedescendant` on the controller to the
 *   active item's id (generating an id if missing); focus stays on the controller.
 *   Optionally also marks the active item (`mark`).
 * - `marked`: toggle a class/attribute (`mark`, default `{ attribute: "aria-selected" }`)
 *   on the active item, clearing it from the previous one.
 * - `controlled`: no DOM mutation; only tracks the active item for navigation.
 */

import type { ResolvedActivation } from "./tree.ts";
import type { ActiveMark } from "./types.ts";

let idCounter = 0;

/** Toggle a mark (class or attribute) on an element. */
function applyMark(el: HTMLElement, mark: ActiveMark, on: boolean): void {
  if ("class" in mark) {
    const classes = mark.class.split(/\s+/).filter(Boolean);
    if (on) el.classList.add(...classes);
    else el.classList.remove(...classes);
  } else if (on) {
    el.setAttribute(mark.attribute, "true");
  } else {
    el.removeAttribute(mark.attribute);
  }
}

interface ActivationState {
  active: HTMLElement | null;
  /** Last activation applied (kept so cleanup knows what to undo). */
  act: ResolvedActivation | null;
  /** Ids Tabspot generated (to remove on cleanup). */
  generatedIds: Set<HTMLElement>;
}

export class ActivationManager {
  private roots = new Map<HTMLElement, ActivationState>();

  getActive(root: HTMLElement): HTMLElement | null {
    return this.roots.get(root)?.active ?? null;
  }

  private stateOf(root: HTMLElement): ActivationState {
    let st = this.roots.get(root);
    if (!st) {
      st = { active: null, act: null, generatedIds: new Set() };
      this.roots.set(root, st);
    }
    return st;
  }

  private ensureId(el: HTMLElement, st: ActivationState): string {
    if (!el.id) {
      el.id = `tabspot-ad-${++idCounter}`;
      st.generatedIds.add(el);
    }
    return el.id;
  }

  /** Set the active item and apply the mode's marker. */
  setActive(root: HTMLElement, act: ResolvedActivation, to: HTMLElement | null): void {
    const st = this.stateOf(root);
    st.act = act;
    const prev = st.active;
    // Clear the mark from the previous active item (marked always, activedescendant
    // when `mark` was set).
    if (act.mark && prev && prev !== to) applyMark(prev, act.mark, false);

    st.active = to;
    if (!to) {
      if (act.mode === "activedescendant" && act.controller) {
        act.controller.removeAttribute("aria-activedescendant");
      }
      return;
    }

    if (act.mode === "activedescendant" && act.controller) {
      act.controller.setAttribute("aria-activedescendant", this.ensureId(to, st));
    }
    if (act.mark) applyMark(to, act.mark, true);
    // controlled: nothing to write.
  }

  /** Stop managing a root, clearing marks and generated ids. */
  unregister(root: HTMLElement): void {
    const st = this.roots.get(root);
    if (!st) return;
    const act = st.act;
    if (act?.mark && st.active) applyMark(st.active, act.mark, false);
    if (act?.mode === "activedescendant" && act.controller) {
      act.controller.removeAttribute("aria-activedescendant");
    }
    for (const el of st.generatedIds) el.removeAttribute("id");
    this.roots.delete(root);
  }

  /** Restore every managed root (used by engine destroy). */
  destroyAll(): void {
    for (const root of Array.from(this.roots.keys())) this.unregister(root);
  }
}
