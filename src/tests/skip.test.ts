import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot, tabspotVirtual } from "../index.ts";
import type {
  TabspotInstance,
  TabspotMoverOptions,
  TabspotNavigationEvent,
  VirtualAdapter,
} from "../index.ts";
import { press } from "./fixtures/context.ts";

let instance: TabspotInstance;
let detach: (() => void) | undefined;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function tick(ms = 40): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** The `data-index` (or text) of the item the controller currently points at. */
function activeLabel(controller: HTMLElement): string | null {
  const id = controller.getAttribute("aria-activedescendant");
  if (!id) return null;
  const el = document.getElementById(id);
  return el?.getAttribute("data-index") ?? el?.textContent?.trim() ?? null;
}
function labels(events: TabspotNavigationEvent[]): (string | null)[] {
  return events.map((e) => {
    const to = e.to as HTMLElement | null;
    if (!to) return e.atEdge === true ? "atEdge" : null;
    return to.getAttribute("data-index") ?? to.textContent?.trim() ?? null;
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  detach?.();
  detach = undefined;
  instance.destroy();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Linear, activedescendant: the cursor must never rest on a skipped item
// ---------------------------------------------------------------------------

describe("skip: linear moves step over skipped items", () => {
  /** `rows`: one entry per option; `true` marks it skipped (`aria-disabled`). */
  function mount(rows: boolean[], mover: Partial<TabspotMoverOptions> = {}): void {
    const html = rows
      .map(
        (skipped, i) =>
          `<li data-index="${i}" class="option"${skipped ? ` aria-disabled="true"` : ""}>${i}</li>`,
      )
      .join("");
    document.body.innerHTML = `<input id="cb" /><ul id="root">${html}</ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: {
        root: { manageSpecialKeys: true },
        mover: {
          axis: "vertical",
          items: ".option",
          skip: "[aria-disabled='true']",
          activation: { mode: "activedescendant", controller: "#cb" },
          ...mover,
        } as TabspotMoverOptions,
      },
    });
  }

  it("passes over a single skipped item in one move", () => {
    const events: TabspotNavigationEvent[] = [];
    mount([false, true, false]);
    instance.subscribe((e) => events.push(e));
    const cb = byId("cb");
    press(cb, "ArrowDown"); // entry -> 0
    press(cb, "ArrowDown"); // 1 is skipped -> 2
    expect(labels(events)).toEqual(["0", "2"]);
    expect(activeLabel(cb)).toBe("2");
  });

  it("traverses a run of consecutive skipped items in a single move", () => {
    const events: TabspotNavigationEvent[] = [];
    mount([false, true, true, true, false]);
    instance.subscribe((e) => events.push(e));
    const cb = byId("cb");
    press(cb, "ArrowDown"); // entry -> 0
    press(cb, "ArrowDown"); // 1,2,3 skipped -> 4
    expect(labels(events)).toEqual(["0", "4"]);
  });

  it("never points aria-activedescendant at a skipped item, not even transiently", () => {
    const seen: (string | null)[] = [];
    mount([false, true, true, false]);
    const cb = byId("cb");
    instance.subscribe(() => seen.push(activeLabel(cb)));
    press(cb, "ArrowDown");
    press(cb, "ArrowDown");
    press(cb, "ArrowUp");
    // Every observed cursor position is a landable row; 1 and 2 never appear.
    const rows = [...seen, activeLabel(cb)].filter((v) => v !== null);
    expect(rows).not.toContain("1");
    expect(rows).not.toContain("2");
  });

  it("reports atEdge when only skipped items remain in that direction", () => {
    const events: TabspotNavigationEvent[] = [];
    mount([false, false, true, true]);
    instance.subscribe((e) => events.push(e));
    const cb = byId("cb");
    press(cb, "ArrowDown"); // -> 0
    press(cb, "ArrowDown"); // -> 1
    events.length = 0;
    press(cb, "ArrowDown"); // 2 and 3 are skipped: nothing to land on
    expect(events).toHaveLength(1);
    expect(events[0]!.atEdge).toBe(true);
    expect(events[0]!.to).toBeNull();
    expect(activeLabel(cb)).toBe("1"); // cursor stayed put
  });

  it("entry lands on the first non-skipped item", () => {
    mount([true, true, false, false]);
    const cb = byId("cb");
    press(cb, "ArrowDown");
    expect(activeLabel(cb)).toBe("2");
  });

  it("backward entry lands on the last non-skipped item", () => {
    mount([false, false, true, true]);
    const cb = byId("cb");
    press(cb, "ArrowUp");
    expect(activeLabel(cb)).toBe("1");
  });

  it("Home and End land on the first and last non-skipped item", () => {
    mount([true, false, false, true]);
    const cb = byId("cb");
    press(cb, "ArrowDown");
    press(cb, "End");
    expect(activeLabel(cb)).toBe("2");
    press(cb, "Home");
    expect(activeLabel(cb)).toBe("1");
  });

  it("a cyclic wrap lands past a skipped item at the far end", () => {
    mount([true, false, false, true], { cyclic: true });
    const cb = byId("cb");
    press(cb, "ArrowDown"); // entry -> 1
    press(cb, "ArrowDown"); // -> 2
    press(cb, "ArrowDown"); // 3 skipped, wrap past 0 (skipped) -> 1
    expect(activeLabel(cb)).toBe("1");
  });

  it("a cyclic mover with a single landable item reports atEdge instead of moving to itself", () => {
    const events: TabspotNavigationEvent[] = [];
    mount([true, false, true], { cyclic: true });
    instance.subscribe((e) => events.push(e));
    const cb = byId("cb");
    press(cb, "ArrowDown"); // entry -> 1
    events.length = 0;
    press(cb, "ArrowDown");
    expect(events).toHaveLength(1);
    expect(events[0]!.atEdge).toBe(true);
    expect(activeLabel(cb)).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Roving (activation: focus)
// ---------------------------------------------------------------------------

describe("skip: roving never parks the tab stop on a skipped item", () => {
  function mount(): void {
    document.body.innerHTML = `
      <ul id="root">
        <li class="option" aria-disabled="true">zero</li>
        <li class="option">one</li>
        <li class="option" aria-disabled="true">two</li>
        <li class="option">three</li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: {
        root: {},
        mover: { axis: "vertical", items: ".option", skip: "[aria-disabled='true']" },
      },
    });
  }

  it("gives the first landable item the tab stop and demotes the skipped ones", () => {
    mount();
    const tabindexes = Array.from(byId("root").children).map((li) => li.getAttribute("tabindex"));
    // Skipped items stay MANAGED at -1 (Tab passes them by) rather than keeping
    // whatever the author left on them.
    expect(tabindexes).toEqual(["-1", "0", "-1", "-1"]);
  });

  it("arrows move focus between landable items only", () => {
    mount();
    const items = Array.from(byId("root").children) as HTMLElement[];
    press(items[1]!, "ArrowDown");
    expect(document.activeElement).toBe(items[3]);
    press(items[3]!, "ArrowUp");
    expect(document.activeElement).toBe(items[1]);
  });

  it("does not migrate the tab stop onto a skipped item that receives focus", () => {
    mount();
    const items = Array.from(byId("root").children) as HTMLElement[];
    items[2]!.focus(); // e.g. a mouse click on a disabled row
    expect(items[2]!.getAttribute("tabindex")).toBe("-1");
    expect(items[1]!.getAttribute("tabindex")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Grid + Page
// ---------------------------------------------------------------------------

/** A grid cell by its text content. */
function cell(text: string): HTMLElement {
  return Array.from(document.querySelectorAll<HTMLElement>(".c")).find(
    (c) => c.textContent?.trim() === text,
  )!;
}

describe("skip: grid movers", () => {
  function mount(): void {
    document.body.innerHTML = `
      <table id="t"><tbody>
        <tr><td class="c">0,0</td><td class="c" aria-disabled="true">0,1</td><td class="c">0,2</td></tr>
        <tr><td class="c">1,0</td><td class="c" aria-disabled="true">1,1</td><td class="c">1,2</td></tr>
        <tr><td class="c">2,0</td><td class="c">2,1</td><td class="c">2,2</td></tr>
      </tbody></table>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("t"),
      config: {
        root: { manageSpecialKeys: true },
        mover: {
          layout: "grid",
          items: ".c",
          skip: "[aria-disabled='true']",
          rows: { by: "selector", row: "tr" },
        },
      },
    });
  }

  it("a horizontal move steps over a skipped cell inside the row", () => {
    mount();
    press(cell("0,0"), "ArrowRight");
    expect(document.activeElement).toBe(cell("0,2"));
  });

  it("a vertical move steps over a skipped cell in the column", () => {
    mount();
    press(cell("0,1"), "ArrowDown"); // 1,1 is skipped too -> 2,1
    expect(document.activeElement).toBe(cell("2,1"));
  });

  it("PageDown lands on a landable row rather than a skipped one", () => {
    mount();
    // pageSize 1 puts the jump on the skipped 1,1; it continues to 2,1.
    setTabspotAttributes({
      element: byId("t"),
      merge: true,
      config: {
        mover: {
          layout: "grid",
          items: ".c",
          skip: "[aria-disabled='true']",
          rows: { by: "selector", row: "tr" },
          pageSize: 1,
        },
      },
    });
    press(cell("0,1"), "PageDown");
    expect(document.activeElement).toBe(cell("2,1"));
  });
});

// ---------------------------------------------------------------------------
// skip without items
// ---------------------------------------------------------------------------

describe("skip: works without an items selector", () => {
  it("filters plain focusables", () => {
    document.body.innerHTML = `
      <div id="root">
        <button>a</button>
        <button class="off">b</button>
        <button>c</button>
      </div>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "horizontal", skip: ".off" } },
    });
    const btns = Array.from(document.querySelectorAll("button")) as HTMLElement[];
    press(btns[0]!, "ArrowRight");
    expect(document.activeElement).toBe(btns[2]);
  });
});

// ---------------------------------------------------------------------------
// skip + virtualization: the index space stays dense
// ---------------------------------------------------------------------------

describe("skip: virtualized boundaries step over skipped rows", () => {
  const TOTAL = 6;
  /** Windowed list where rows 1..2 are rendered but skipped. */
  function mount(rendered: number[]): void {
    document.body.innerHTML = `<input id="cb" /><ul id="root"></ul>`;
    const root = byId("root");
    const render = (i: number): void => {
      if (i < 0 || i >= TOTAL || root.querySelector(`[data-index="${i}"]`)) return;
      const li = document.createElement("li");
      li.setAttribute("data-index", String(i));
      li.className = "option";
      if (i === 1 || i === 2) li.setAttribute("aria-disabled", "true");
      li.textContent = String(i);
      const after = Array.from(root.children).find((c) => Number(c.getAttribute("data-index")) > i);
      root.insertBefore(li, after ?? null);
    };
    for (const i of rendered) render(i);
    instance = tabspot();
    setTabspotAttributes({
      element: root,
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: ".option",
          skip: "[aria-disabled='true']",
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });
    const adapter: VirtualAdapter = { count: () => TOTAL, scrollToIndex: (i) => render(i) };
    detach = tabspotVirtual(root, adapter);
  }

  it("walks past skipped rows outside the window and lands beyond them", async () => {
    const events: TabspotNavigationEvent[] = [];
    mount([3]); // only row 3 is rendered
    instance.subscribe((e) => events.push(e));
    const cb = byId("cb");
    press(cb, "ArrowDown"); // entry -> 3
    await tick();
    expect(activeLabel(cb)).toBe("3");
    events.length = 0;
    press(cb, "ArrowUp"); // 2 and 1 are skipped -> 0
    await tick(120);
    expect(labels(events)).toEqual(["0"]);
    expect(events[0]!.atRenderedBoundary).toBe(true);
    expect(activeLabel(cb)).toBe("0");
  });

  it("reports atEdge when the walk finds only skipped rows", async () => {
    const events: TabspotNavigationEvent[] = [];
    mount([0]); // rows 1..2 skipped, 3..5 land beyond — walk down instead
    instance.subscribe((e) => events.push(e));
    const cb = byId("cb");
    press(cb, "ArrowDown"); // entry -> 0
    await tick();
    events.length = 0;
    press(cb, "ArrowUp"); // nothing above index 0
    await tick(120);
    expect(events).toHaveLength(1);
    expect(events[0]!.atEdge).toBe(true);
  });
});
