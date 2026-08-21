import type { Visibility } from "./types.ts";

/**
 * Matches every element treated as a focusable for Tabspot navigation.
 * Includes natively focusable controls plus any element exposing tabindex.
 */
const NATIVE_FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "audio[controls]",
  "video[controls]",
  "iframe",
  "object",
  "embed",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",");

/**
 * Whether `el` is a Tabspot-navigable focusable.
 *
 * `allowNegativeTabindex` flips the meaning of `tabindex="-1"`: by default it
 * means "skip me" (native programmatic-only idiom), but under a roving root it
 * marks an inactive-but-navigable item (that's how Tabspot demotes items), so it
 * must count as focusable.
 */
export function isFocusable(el: Element, allowNegativeTabindex = false): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const tabIndexAttr = el.getAttribute("tabindex");
  if (tabIndexAttr !== null) {
    const n = Number(tabIndexAttr);
    // A malformed tabindex (NaN) is ignored by the browser — fall back to native.
    if (Number.isNaN(n)) return el.matches(NATIVE_FOCUSABLE_SELECTOR);
    if (n < 0) return allowNegativeTabindex;
    return true;
  }
  return el.matches(NATIVE_FOCUSABLE_SELECTOR);
}

/**
 * `el.matches(selector)` that cannot throw: an invalid selector matches nothing
 * instead of breaking a build or a keystroke mid-flight. Shared by every
 * author-supplied selector (`items`, `skip`).
 */
export function safeMatches(el: HTMLElement, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * Walk descendants of `root` (excluding `root` itself) in document order.
 * Yields every element, but does NOT descend into a subtree when
 * `stopAt(node)` returns true — i.e. configured wrappers and focusables
 * are emitted but their internals are left for callers to handle.
 */
export function* walk(root: Element, stopAt: (el: Element) => boolean): Generator<Element> {
  const stack: Element[] = [];
  for (let i = root.children.length - 1; i >= 0; i--) {
    stack.push(root.children[i]);
  }
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    if (stopAt(node)) continue;
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }
}

export function getVisibility(el: HTMLElement): Visibility {
  // checkVisibility returns boolean; we map directly to Visible | Invisible.
  const supportsCheckVisibility =
    typeof (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility === "function";
  if (!supportsCheckVisibility) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? "Visible" : "Invisible";
  }
  const visible = (
    el as HTMLElement & {
      checkVisibility: (opts?: {
        checkOpacity?: boolean;
        checkVisibilityCSS?: boolean;
        contentVisibilityAuto?: boolean;
      }) => boolean;
    }
  ).checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
    contentVisibilityAuto: true,
  });
  return visible ? "Visible" : "Invisible";
}

export function meetsVisibility(el: HTMLElement, threshold: Visibility): boolean {
  if (threshold === "Invisible") return true;
  const order: Record<Visibility, number> = {
    Invisible: 0,
    Visible: 1,
  };
  return order[getVisibility(el)] >= order[threshold];
}
