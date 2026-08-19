import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot, tabspotVirtual } from "../index.ts";
import type { TabspotInstance, TabspotNavigationEvent, VirtualAdapter } from "../index.ts";
import { press } from "./fixtures/context.ts";

let instance: TabspotInstance;
let detach: () => void;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function tick(ms = 40): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function renderRow(root: HTMLElement, i: number): void {
  if (root.querySelector(`[data-index="${i}"]`)) return;
  const li = document.createElement("li");
  li.setAttribute("data-index", String(i));
  li.setAttribute("tabindex", "-1");
  li.textContent = String(i);
  root.appendChild(li);
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  detach?.();
  instance.destroy();
  document.body.innerHTML = "";
});

describe("virtualization: linear list", () => {
  const TOTAL = 100;

  function mount(): void {
    // Only 3 of 100 items are rendered (the window).
    document.body.innerHTML = `
      <ul id="root">
        <li data-index="0" tabindex="0">0</li>
        <li data-index="1" tabindex="-1">1</li>
        <li data-index="2" tabindex="-1">2</li>
      </ul>`;
    const root = byId("root");
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (i) => {
        if (!root.querySelector(`[data-index="${i}"]`)) {
          const li = document.createElement("li");
          li.setAttribute("data-index", String(i));
          li.setAttribute("tabindex", "-1");
          li.textContent = String(i);
          root.appendChild(li);
        }
      },
    };
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, adapter);
  }

  it("ArrowDown past the rendered window scrolls, renders, and focuses the next real item", async () => {
    mount();
    press(byId("root").querySelector('[data-index="2"]') as HTMLElement, "ArrowDown");
    await tick();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("3");
  });

  it("does not scroll past the total count", async () => {
    mount();
    // Render item 99 and focus it, then ArrowDown should do nothing (99 is last).
    (byId("root") as HTMLElement).insertAdjacentHTML(
      "beforeend",
      `<li data-index="99" tabindex="-1">99</li>`,
    );
    const last = byId("root").querySelector('[data-index="99"]') as HTMLElement;
    press(last, "ArrowDown");
    await tick();
    expect(document.activeElement).toBe(last);
    expect(byId("root").querySelector('[data-index="100"]')).toBeNull();
  });
});

describe("virtualization: linear list with cyclic", () => {
  const TOTAL = 100;

  function mount(): void {
    // Window of 3 items somewhere in the middle of the 100-item list.
    document.body.innerHTML = `
      <ul id="root">
        <li data-index="50" tabindex="0">50</li>
        <li data-index="51" tabindex="-1">51</li>
        <li data-index="52" tabindex="-1">52</li>
      </ul>`;
    const root = byId("root");
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (i) => {
        if (!root.querySelector(`[data-index="${i}"]`)) {
          const li = document.createElement("li");
          li.setAttribute("data-index", String(i));
          li.setAttribute("tabindex", "-1");
          li.textContent = String(i);
          root.appendChild(li);
        }
      },
    };
    instance = tabspot();
    setTabspotAttributes({
      element: root,
      config: { root: {}, mover: { axis: "vertical", cyclic: true } },
    });
    detach = tabspotVirtual(root, adapter);
  }

  it("ArrowUp on the real first item wraps to the real last item (not last rendered)", async () => {
    mount();
    // Render and focus item 0 (the real first item).
    byId("root").insertAdjacentHTML("afterbegin", `<li data-index="0" tabindex="-1">0</li>`);
    const first = byId("root").querySelector('[data-index="0"]') as HTMLElement;
    press(first, "ArrowUp");
    await tick();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("99");
  });

  it("ArrowDown on the real last item wraps to the real first item", async () => {
    mount();
    byId("root").insertAdjacentHTML("beforeend", `<li data-index="99" tabindex="-1">99</li>`);
    const last = byId("root").querySelector('[data-index="99"]') as HTMLElement;
    press(last, "ArrowDown");
    await tick();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("0");
  });

  it("ArrowUp at the rendered edge (mid-list) scrolls to the previous real item, not a wrap", async () => {
    mount();
    // Window is [50,51,52]; ArrowUp on 50 should reach 49, not wrap to 99.
    const top = byId("root").querySelector('[data-index="50"]') as HTMLElement;
    press(top, "ArrowUp");
    await tick();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("49");
  });
});

describe("virtualization: tick (framework render-flush hook)", () => {
  const TOTAL = 100;

  function baseMarkup(): HTMLElement {
    document.body.innerHTML = `
      <ul id="root">
        <li data-index="0" tabindex="0">0</li>
        <li data-index="1" tabindex="-1">1</li>
        <li data-index="2" tabindex="-1">2</li>
      </ul>`;
    return byId("root");
  }

  it("renders via the awaited tick (scrollToIndex defers, tick flushes)", async () => {
    const root = baseMarkup();
    // scrollToIndex only records intent; the row appears solely because tick()
    // flushes it. If Tabspot didn't await tick, the node would never be found.
    let pending: number | null = null;
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (i) => {
        pending = i;
      },
      tick: () => {
        if (pending !== null) renderRow(root, pending);
        pending = null;
        return Promise.resolve();
      },
    };
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, adapter);

    press(root.querySelector('[data-index="2"]') as HTMLElement, "ArrowDown");
    await tick();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("3");
  });

  it("falls back to the observer when tick resolves before the row renders", async () => {
    const root = baseMarkup();
    // A scroll-event-driven virtualizer: the row lands a tick later than the
    // flush hook resolves, so the MutationObserver safety net must catch it.
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (i) => {
        setTimeout(() => renderRow(root, i), 5);
      },
      tick: () => Promise.resolve(),
    };
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, adapter);

    press(root.querySelector('[data-index="2"]') as HTMLElement, "ArrowDown");
    await tick();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("3");
  });
});

describe("virtualization: dataTable (rows virtualized, column preserved)", () => {
  const TOTAL = 100;

  function mount(): void {
    document.body.innerHTML = `
      <table id="t"><tbody id="tb">
        <tr data-index="0"><td data-colindex="0">0,0</td><td data-colindex="1">0,1</td></tr>
        <tr data-index="1"><td data-colindex="0">1,0</td><td data-colindex="1">1,1</td></tr>
      </tbody></table>`;
    const root = byId("t");
    const tb = byId("tb");
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (r) => {
        if (!root.querySelector(`[data-index="${r}"]`)) {
          const tr = document.createElement("tr");
          tr.setAttribute("data-index", String(r));
          for (let c = 0; c < 2; c++) {
            const td = document.createElement("td");
            td.setAttribute("data-colindex", String(c));
            td.textContent = `${r},${c}`;
            tr.appendChild(td);
          }
          tb.appendChild(tr);
        }
      },
    };
    instance = tabspot();
    setTabspotAttributes({
      element: root,
      config: {
        root: {},
        mover: { layout: "grid", items: "td", rows: { by: "selector", row: "tr" } },
      },
    });
    detach = tabspotVirtual(root, adapter);
  }

  it("ArrowDown past the last rendered row scrolls and preserves the column", async () => {
    mount();
    const cell = byId("t").querySelector('[data-index="1"] [data-colindex="1"]') as HTMLElement;
    press(cell, "ArrowDown");
    await tick();
    expect(document.activeElement?.textContent).toBe("2,1");
  });
});

describe("virtualization: a windowed origin must not drop the move", () => {
  const TOTAL = 100;

  /** Adapter that renders `i` and evicts every row before it, like a real window. */
  function mount(): void {
    document.body.innerHTML = `
      <ul id="root">
        <li data-index="0" tabindex="0">0</li>
        <li data-index="1" tabindex="-1">1</li>
        <li data-index="2" tabindex="-1">2</li>
      </ul>`;
    const root = byId("root");
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (i) => {
        renderRow(root, i);
        for (const li of Array.from(root.children)) {
          const idx = Number(li.getAttribute("data-index"));
          if (idx < i) li.remove(); // the origin row leaves the DOM
        }
      },
    };
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, adapter);
  }

  it("completes the move even when the origin row unmounted mid-scroll", async () => {
    mount();
    press(byId("root").querySelector('[data-index="2"]') as HTMLElement, "ArrowDown");
    await tick();
    // Row 2 is gone, but the keystroke still lands on 3.
    expect(byId("root").querySelector('[data-index="2"]')).toBeNull();
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("3");
  });

  it("reports the move with a null origin instead of swallowing it", async () => {
    const events: TabspotNavigationEvent[] = [];
    mount();
    instance.subscribe((e) => events.push(e));
    press(byId("root").querySelector('[data-index="2"]') as HTMLElement, "ArrowDown");
    await tick();
    const committed = events.at(-1)!;
    expect(committed.atRenderedBoundary).toBe(true);
    expect(committed.from).toBeNull();
    expect((committed.to as HTMLElement).getAttribute("data-index")).toBe("3");
  });
});

describe("virtualization: the real end of the list reports an edge", () => {
  const TOTAL = 100;

  function mount(): void {
    document.body.innerHTML = `<ul id="root"><li data-index="98" tabindex="-1">98</li></ul>`;
    const root = byId("root");
    const adapter: VirtualAdapter = {
      count: () => TOTAL,
      scrollToIndex: (i) => renderRow(root, i),
    };
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, adapter);
  }

  it("no edge while there are still real rows beyond the window", async () => {
    const events: TabspotNavigationEvent[] = [];
    mount();
    instance.subscribe((e) => events.push(e));
    press(byId("root").querySelector('[data-index="98"]') as HTMLElement, "ArrowDown");
    await tick();
    expect(events.every((e) => !e.atEdge)).toBe(true);
    expect((document.activeElement as HTMLElement).getAttribute("data-index")).toBe("99");
  });

  it("edge fires once the real last row is reached", async () => {
    const events: TabspotNavigationEvent[] = [];
    mount();
    const root = byId("root");
    root.insertAdjacentHTML("beforeend", `<li data-index="99" tabindex="-1">99</li>`);
    instance.subscribe((e) => events.push(e));
    press(root.querySelector('[data-index="99"]') as HTMLElement, "ArrowDown");
    await tick();
    expect(events.at(-1)?.atEdge).toBe(true);
    expect(events.at(-1)?.to).toBeNull();
  });
});

describe("virtualization: only a real boundary reports an edge", () => {
  const TOTAL = 100;

  function mountLinear(): void {
    document.body.innerHTML = `
      <ul id="root">
        <li data-index="98" tabindex="-1">98</li>
        <li data-index="99" tabindex="-1">99</li>
      </ul>`;
    const root = byId("root");
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, { count: () => TOTAL, scrollToIndex: (i) => renderRow(root, i) });
  }

  it("a cross-axis key on a vertical virtual root reports nothing", async () => {
    const events: TabspotNavigationEvent[] = [];
    mountLinear();
    instance.subscribe((e) => events.push(e));
    // ArrowRight is grouper territory, never an edge — but it also makes
    // resolveBoundaryTarget return null, which used to be read as "real edge".
    press(byId("root").querySelector('[data-index="99"]') as HTMLElement, "ArrowRight");
    await tick();
    expect(events).toEqual([]);
  });

  it("the real last row reports the edge exactly once", async () => {
    const events: TabspotNavigationEvent[] = [];
    mountLinear();
    instance.subscribe((e) => events.push(e));
    press(byId("root").querySelector('[data-index="99"]') as HTMLElement, "ArrowDown");
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]!.atEdge).toBe(true);
  });

  it("a row without a real index reports the edge once (navigation owns it)", async () => {
    const events: TabspotNavigationEvent[] = [];
    document.body.innerHTML = `
      <ul id="root">
        <li tabindex="-1">a</li>
        <li tabindex="-1">b</li>
      </ul>`;
    const root = byId("root");
    instance = tabspot();
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    detach = tabspotVirtual(root, { count: () => TOTAL, scrollToIndex: (i) => renderRow(root, i) });
    instance.subscribe((e) => events.push(e));
    press(root.querySelectorAll("li")[1] as HTMLElement, "ArrowDown");
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]!.atEdge).toBe(true);
  });

  it("a grid's horizontal edge reports once (columns are not virtualized)", async () => {
    const events: TabspotNavigationEvent[] = [];
    document.body.innerHTML = `
      <table id="t"><tbody id="tb">
        <tr data-index="0"><td data-colindex="0">0,0</td><td data-colindex="1">0,1</td></tr>
      </tbody></table>`;
    const root = byId("t");
    instance = tabspot();
    setTabspotAttributes({
      element: root,
      config: {
        root: {},
        mover: { layout: "grid", items: "td", rows: { by: "selector", row: "tr" } },
      },
    });
    detach = tabspotVirtual(root, { count: () => TOTAL, scrollToIndex: () => {} });
    instance.subscribe((e) => events.push(e));
    press(root.querySelector('[data-colindex="1"]') as HTMLElement, "ArrowRight");
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]!.atEdge).toBe(true);
  });
});
