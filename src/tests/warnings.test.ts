import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
import type { TabspotInstance, TabspotNodeOptions, TabspotRootOptions } from "../index.ts";

let instance: TabspotInstance;
let warns: string[];

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

/** Mount an app root with a NESTED mover that (wrongly) declares activation. */
function mount(rootOpts: TabspotRootOptions, globalDebug?: "basic" | "full"): void {
  document.body.innerHTML = `
    <div id="app">
      <ul id="lb" data-tabspot='{"mover":{"axis":"vertical","items":"li","activation":"marked"}}'>
        <li>A</li><li>B</li>
      </ul>
    </div>`;
  warns = [];
  instance = tabspot({
    debug: globalDebug,
    logger: (level, args) => {
      if (level === "warn") warns.push(String(args[0]));
    },
  });
  setTabspotAttributes({
    element: byId("app"),
    config: { root: rootOpts, mover: { axis: "vertical" } },
  });
}

const HIT = (w: string) => w.includes("activation on a nested mover");

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  instance.destroy();
  document.body.innerHTML = "";
});

describe("debug warning: activation on a nested mover", () => {
  it("warns when the global debug is on", () => {
    mount({}, "basic");
    expect(warns.some(HIT)).toBe(true);
  });

  it("stays silent when no debug is on", () => {
    mount({});
    expect(warns.some(HIT)).toBe(false);
  });

  it("root.debug scopes the diagnostic (global off, root on)", () => {
    mount({ debug: "full" }); // global debug off, this root opts in
    expect(warns.some(HIT)).toBe(true);
  });
});
