import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot, tabspotVirtual } from "../index.ts";
import type { TabspotInstance, VirtualAdapter } from "../index.ts";
import { press } from "./fixtures/context.ts";

let instance: TabspotInstance;
let detach: () => void;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function tick(ms = 40): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
