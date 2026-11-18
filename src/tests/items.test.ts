import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotActive, setTabspotAttributes, tabspot } from "../index.ts";
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

describe("removing navigation items", () => {
  function mount(options?: Parameters<typeof tabspot>[0], marked = false): HTMLElement {
    document.body.innerHTML = `
      <div id="list" tabindex="0">
        <div><button id="a">A</button><button id="b">B</button><button id="c">C</button></div>
      </div>`;
    instance = tabspot(options);
    const root = byId("list");
    setTabspotAttributes({
      element: root,
      config: { root: {}, mover: { axis: "vertical", activation: marked ? "marked" : "focus" } },
    });
    return root;
  }

  it("skips a removed item after the observer delivers the removal", async () => {
    const destinations: (HTMLElement | null)[] = [];
    mount({ onNavigate: ({ to }) => destinations.push(to) });
    const a = byId("a");
    const c = byId("c");
    a.focus();
    // Deliver the setup records first so they cannot mask a removal-only batch.
    await Promise.resolve();
    press(a, "ArrowDown");
    a.focus();
    destinations.length = 0;

    byId("b").remove();
    await Promise.resolve();
    press(a, "ArrowDown");

    expect(destinations).toEqual([c]);
    expect(document.activeElement).toBe(c);
  });

  it("skips a removed item when a key fires in the same task", () => {
    mount();
    const a = byId("a");
    a.focus();
    byId("b").remove();
    press(a, "ArrowDown");
    expect(document.activeElement).toBe(byId("c"));
  });

  it("leaves the key unclaimed when a listener moves the destination outside the root", () => {
    mount();
    const a = byId("a");
    const b = byId("b");
    instance.subscribe(({ to }) => {
      if (to === b) document.body.append(b);
    });
    a.focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    a.dispatchEvent(event);

    expect(b.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(a);
    expect(event.defaultPrevented).toBe(false);
    press(a, "ArrowDown");
    expect(document.activeElement).toBe(byId("c"));
  });

  it("rejects a programmatic move when a listener disconnects the destination", () => {
    mount({ onNavigate: ({ to }) => to?.remove() }, true);
    const b = byId("b");
    expect(setTabspotActive(b)).toMatchObject({ ok: false, reason: "not-an-item" });
    expect(b.isConnected).toBe(false);
  });
});

describe("listener changes to item membership", () => {
  function mount(activation: "focus" | "marked"): void {
    document.body.innerHTML = `
      <div id="list" tabindex="0">
        <button id="a" class="item">A</button>
        <button id="b" class="item">B</button>
      </div>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("list"),
      config: { root: {}, mover: { axis: "vertical", items: ".item", activation } },
    });
    if (activation === "focus") byId("a").focus();
    else setTabspotActive(byId("a"));
  }

  for (const activation of ["focus", "marked"] as const) {
    it.each([false, true])(
      `${activation}: revalidates membership after a listener (still matches: %s)`,
      (stillMatches) => {
        mount(activation);
        const a = byId("a");
        const b = byId("b");
        instance.subscribe(({ to }) => {
          if (to === b) b.className = stillMatches ? "item changed" : "changed";
        });
        const event = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        });
        (activation === "focus" ? a : byId("list")).dispatchEvent(event);

        expect(event.defaultPrevented).toBe(stillMatches);
        if (activation === "focus") expect(document.activeElement).toBe(stillMatches ? b : a);
        else {
          expect(a.hasAttribute("data-active")).toBe(!stillMatches);
          expect(b.hasAttribute("data-active")).toBe(stillMatches);
        }
      },
    );
  }

  it.each([false, true])("revalidates programmatic moves (still matches: %s)", (stillMatches) => {
    mount("marked");
    const b = byId("b");
    instance.subscribe(({ to }) => {
      if (to === b) b.className = stillMatches ? "item changed" : "changed";
    });
    expect(setTabspotActive(b)).toMatchObject(
      stillMatches ? { ok: true, moved: true } : { ok: false, reason: "not-an-item" },
    );
    expect(byId("a").hasAttribute("data-active")).toBe(!stillMatches);
    expect(b.hasAttribute("data-active")).toBe(stillMatches);
  });
});
