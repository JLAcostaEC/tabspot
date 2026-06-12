import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";

let instance: ReturnType<typeof tabspot>;

beforeEach(() => {
  document.body.innerHTML = "";
  instance = tabspot();
});
afterEach(() => instance.destroy());

describe("attributes / engine", () => {
  it("setTabspotAttributes writes valid data-tabspot", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    setTabspotAttributes({ element: el, config: { root: {}, mover: { axis: "vertical" } } });
    const raw = el.getAttribute("data-tabspot");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ root: {}, mover: { axis: "vertical" } });
    expect(el.hasAttribute("data-tabspot-root")).toBe(false);
  });

  it("rejects nested roots", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    setTabspotAttributes({ element: outer, config: { root: {} } });
    const result = setTabspotAttributes({ element: inner, config: { root: {} } });
    expect(result.ok).toBe(false);
    expect(inner.hasAttribute("data-tabspot")).toBe(false);
  });

  it("tabspot() returns the same singleton", () => {
    const a = tabspot({ debug: "basic" });
    const b = tabspot();
    expect(a).toBe(b);
  });

  it("MutationObserver marks tree dirty when DOM changes", async () => {
    const root = document.createElement("ul");
    root.setAttribute("tabindex", "-1");
    document.body.appendChild(root);
    const a = document.createElement("li");
    a.tabIndex = 0;
    a.textContent = "A";
    const b = document.createElement("li");
    b.tabIndex = 0;
    b.textContent = "B";
    root.append(a, b);
    setTabspotAttributes({
      element: root,
      config: { root: {}, mover: { axis: "vertical" } },
    });

    a.focus();
    a.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(b);

    // Insert C dynamically; next keydown should pick it up.
    const c = document.createElement("li");
    c.tabIndex = 0;
    c.textContent = "C";
    root.appendChild(c);
    await new Promise((r) => setTimeout(r, 10));
    b.focus();
    b.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(c);
  });

  it("ignoreKeys lets ArrowDown fall through to native", () => {
    const root = document.createElement("ul");
    document.body.appendChild(root);
    const a = document.createElement("li");
    a.tabIndex = 0;
    const b = document.createElement("li");
    b.tabIndex = 0;
    root.append(a, b);
    setTabspotAttributes({
      element: root,
      config: { root: {}, mover: { axis: "vertical", ignoreKeys: ["ArrowDown"] } },
    });

    a.focus();
    a.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    // Should NOT have moved focus — Tabspot ignored the key.
    expect(document.activeElement).toBe(a);
  });

  it("removing the root section unregisters the root", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const a = document.createElement("button");
    const b = document.createElement("button");
    root.append(a, b);
    setTabspotAttributes({
      element: root,
      config: { root: {}, mover: { axis: "horizontal" } },
    });
    a.focus();
    a.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(b);

    // Drop the root section -> Tabspot should stop managing this subtree.
    setTabspotAttributes({
      element: root,
      config: { mover: { axis: "horizontal" } },
    });
    a.focus();
    a.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(a);
  });
});
