import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setTabspotAttributes,
  setTabspotAttributesBatch,
  tabspot,
  unsetTabspotSection,
} from "../index.ts";
import type { TabspotInstance } from "../index.ts";

let instance: TabspotInstance;

function div(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  instance.destroy();
  document.body.innerHTML = "";
});

describe("setTabspotAttributes result type", () => {
  it("ok:true with the instance on a valid config", () => {
    instance = tabspot();
    const r = setTabspotAttributes({
      element: div(),
      config: { root: {}, mover: { axis: "vertical" } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.instance).toBe(instance);
  });

  it("ok:false reason 'invalid' on a bad config (DOM untouched)", () => {
    instance = tabspot();
    const el = div();
    const r = setTabspotAttributes({
      element: el,
      config: { mover: { axis: "diagonal" } } as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
    expect(el.hasAttribute("data-tabspot")).toBe(false);
  });

  it("ok:false reason 'nested-root'", () => {
    instance = tabspot();
    const outer = div();
    const inner = document.createElement("div");
    outer.appendChild(inner);
    setTabspotAttributes({ element: outer, config: { root: {} } });
    const r = setTabspotAttributes({ element: inner, config: { root: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("nested-root");
  });
});

describe("batch + unset", () => {
  it("setTabspotAttributesBatch returns a result per entry", () => {
    instance = tabspot();
    const a = div();
    const b = div();
    const results = setTabspotAttributesBatch([
      { element: a, config: { root: {}, mover: { axis: "vertical" } } },
      { element: b, config: { root: {}, mover: { axis: "horizontal" } } },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("unsetTabspotSection removes a single section", () => {
    instance = tabspot();
    const el = div();
    setTabspotAttributes({ element: el, config: { root: {}, mover: { axis: "vertical" } } });
    unsetTabspotSection(el, "mover");
    const cfg = JSON.parse(el.getAttribute("data-tabspot") as string);
    expect(cfg.mover).toBeUndefined();
    expect(cfg.root).toBeDefined();
  });
});

describe("debug sink", () => {
  it("routes logs to the custom sink", () => {
    const levels: string[] = [];
    instance = tabspot({ debug: "basic", logger: (level) => levels.push(level) });
    expect(levels).toContain("basic"); // "engine started"
  });
});
