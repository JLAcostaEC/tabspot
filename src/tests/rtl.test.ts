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

describe("RTL horizontal navigation (root.rtl)", () => {
  function mount(rtl: "rtl" | "ltr" | "auto"): void {
    document.body.innerHTML = `
      <ul id="root">
        <li id="a" tabindex="-1">A</li>
        <li id="b" tabindex="-1">B</li>
        <li id="c" tabindex="-1">C</li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: { rtl }, mover: { axis: "horizontal" } },
    });
  }

  it("ArrowLeft advances and ArrowRight goes back when rtl", () => {
    mount("rtl");
    press(byId("a"), "ArrowLeft");
    expect(document.activeElement).toBe(byId("b"));
    press(byId("b"), "ArrowRight");
    expect(document.activeElement).toBe(byId("a"));
  });

  it("ArrowLeft at the first item does nothing (no wrap) in rtl", () => {
    mount("rtl");
    press(byId("a"), "ArrowRight"); // backward at the start -> clamp
    expect(document.activeElement).toBe(byId("a"));
  });

  it("ltr keeps native direction (ArrowRight advances)", () => {
    mount("ltr");
    press(byId("a"), "ArrowRight");
    expect(document.activeElement).toBe(byId("b"));
    press(byId("b"), "ArrowLeft");
    expect(document.activeElement).toBe(byId("a"));
  });
});
