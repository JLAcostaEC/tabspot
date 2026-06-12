import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
import type { TabspotInstance } from "../index.ts";
import { press } from "./fixtures/context.ts";

let instance: TabspotInstance;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  instance.destroy();
  document.body.innerHTML = "";
});

describe("items selector (declared navigable set)", () => {
  function mount(): void {
    // Divs with onclick semantics and NO tabindex — only `.cell` are items.
    document.body.innerHTML = `
      <div id="grid">
        <div id="a" class="cell">A</div>
        <div id="b" class="cell">B</div>
        <span id="deco">decoration</span>
        <div id="c" class="cell">C</div>
      </div>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("grid"),
      config: { root: {}, mover: { axis: "horizontal", items: ".cell" } },
    });
  }

  it("grants focusability to matching elements that had no tabindex", () => {
    mount();
    expect(byId("a").getAttribute("tabindex")).toBe("0");
    expect(byId("b").getAttribute("tabindex")).toBe("-1");
    expect(byId("c").getAttribute("tabindex")).toBe("-1");
  });

  it("leaves non-matching elements untouched and unreachable", () => {
    mount();
    expect(byId("deco").getAttribute("tabindex")).toBeNull();
    // ArrowRight from B skips the non-item <span> and lands on C.
    press(byId("b"), "ArrowRight");
    expect(document.activeElement).toBe(byId("c"));
  });

  it("navigates between items with arrows", () => {
    mount();
    press(byId("a"), "ArrowRight");
    expect(document.activeElement).toBe(byId("b"));
  });

  it("restores (removes the granted tabindex) on destroy", () => {
    mount();
    expect(byId("a").getAttribute("tabindex")).toBe("0");
    instance.destroy();
    // Originals were absent → removed on restore.
    expect(byId("a").getAttribute("tabindex")).toBeNull();
    expect(byId("b").getAttribute("tabindex")).toBeNull();
  });
});

describe("items selector with grid layout + rows by selector", () => {
  function mount(): void {
    document.body.innerHTML = `
      <table id="t">
        <tbody>
          <tr><td><button id="r0c0">00</button></td><td><button id="r0c1">01</button></td></tr>
          <tr><td><button id="r1c0">10</button></td><td><button id="r1c1">11</button></td></tr>
        </tbody>
      </table>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("t"),
      config: {
        root: {},
        mover: { layout: "grid", items: "button", rows: { by: "selector", row: "tr" } },
      },
    });
  }

  it("groups nested-cell focusables into rows via closest(row)", () => {
    mount();
    // ArrowDown from r0c1 -> r1c1 (same column, next row), proving rows = <tr>.
    press(byId("r0c1"), "ArrowDown");
    expect(document.activeElement).toBe(byId("r1c1"));
  });

  it("horizontal stays within the row", () => {
    mount();
    press(byId("r0c0"), "ArrowRight");
    expect(document.activeElement).toBe(byId("r0c1"));
    press(byId("r0c1"), "ArrowRight");
    expect(document.activeElement).toBe(byId("r0c1")); // clamped at row end
  });
});
