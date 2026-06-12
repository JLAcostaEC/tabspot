import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
import type { TabspotInstance, TabspotNodeOptions } from "../index.ts";
import { press } from "./fixtures/context.ts";

let instance: TabspotInstance;

function ti(id: string): string | null {
  return (document.getElementById(id) as HTMLElement).getAttribute("tabindex");
}

/** Mount a 3-item vertical list and register it with `config`. */
function mount(config: TabspotNodeOptions, initialTabindex: string): void {
  document.body.innerHTML = `
    <ul id="root">
      <li id="a" tabindex="${initialTabindex}">A</li>
      <li id="b" tabindex="${initialTabindex}">B</li>
      <li id="c" tabindex="${initialTabindex}">C</li>
    </ul>`;
  instance = tabspot();
  setTabspotAttributes({ element: document.getElementById("root") as HTMLElement, config });
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  instance.destroy();
  document.body.innerHTML = "";
});

describe("roving tabindex (activation: focus, default)", () => {
  it("on register, exactly one item is the tab stop (0), the rest -1", () => {
    mount({ root: {}, mover: { axis: "vertical" } }, "-1");
    expect(ti("a")).toBe("0");
    expect(ti("b")).toBe("-1");
    expect(ti("c")).toBe("-1");
  });

  it("items authored with tabindex=-1 are still navigable (the roving flip)", () => {
    mount({ root: {}, mover: { axis: "vertical" } }, "-1");
    press(document.getElementById("a") as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(document.getElementById("b"));
  });

  it("ArrowDown migrates the tab stop to the focused item", () => {
    mount({ root: {}, mover: { axis: "vertical" } }, "-1");
    press(document.getElementById("a") as HTMLElement, "ArrowDown");
    expect(ti("a")).toBe("-1");
    expect(ti("b")).toBe("0");
    expect(ti("c")).toBe("-1");
  });

  it("focusing an item by mouse/programmatic also migrates the tab stop", () => {
    mount({ root: {}, mover: { axis: "vertical" } }, "-1");
    (document.getElementById("c") as HTMLElement).focus();
    expect(ti("c")).toBe("0");
    expect(ti("a")).toBe("-1");
  });

  it("restores original tabindex on destroy", () => {
    mount({ root: {}, mover: { axis: "vertical" } }, "-1");
    (document.getElementById("c") as HTMLElement).focus(); // c -> 0, a -> -1
    expect(ti("c")).toBe("0");
    instance.destroy();
    // originals were all "-1"
    expect(ti("a")).toBe("-1");
    expect(ti("c")).toBe("-1");
  });

  it("auto-unregisters (and restores tabindex) when the root is removed from the DOM", async () => {
    mount({ root: {}, mover: { axis: "vertical" } }, "-1");
    const a = document.getElementById("a") as HTMLElement; // tab stop -> "0"
    expect(a.getAttribute("tabindex")).toBe("0");
    (document.getElementById("root") as HTMLElement).remove();
    await new Promise((r) => setTimeout(r, 20)); // let the MutationObserver run
    expect(a.getAttribute("tabindex")).toBe("-1"); // restored from "0"
  });
});

describe("roving disabled (activation: { mode: focus, roving: false })", () => {
  it("leaves the author's tabindex untouched", () => {
    mount(
      { root: {}, mover: { axis: "vertical", activation: { mode: "focus", roving: false } } },
      "0",
    );
    expect(ti("a")).toBe("0");
    expect(ti("b")).toBe("0");
    expect(ti("c")).toBe("0");
  });

  it("still navigates with arrows", () => {
    mount(
      { root: {}, mover: { axis: "vertical", activation: { mode: "focus", roving: false } } },
      "0",
    );
    press(document.getElementById("a") as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(document.getElementById("b"));
  });
});
