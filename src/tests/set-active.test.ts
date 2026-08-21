import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearTabspotActive,
  setTabspotActive,
  setTabspotAttributes,
  tabspot,
  tabspotVirtual,
} from "../index.ts";
import type {
  SetActiveResult,
  TabspotInstance,
  TabspotMoverOptions,
  TabspotNavigationEvent,
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
function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".option"));
}
/** The item the controller currently points at, by text. */
function activeText(controller: HTMLElement): string | null {
  const id = controller.getAttribute("aria-activedescendant");
  return id ? (document.getElementById(id)?.textContent?.trim() ?? null) : null;
}
/** Narrow to the failure arm so `reason` is readable without casts. */
function refusal(r: SetActiveResult): Extract<SetActiveResult, { ok: false }> {
  if (r.ok) throw new Error(`expected a refusal, got ok (moved=${r.moved})`);
  return r;
}
function success(r: SetActiveResult): Extract<SetActiveResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r;
}

/** A 4-option listbox driven by an input (activedescendant). */
function mountCombobox(mover: Partial<TabspotMoverOptions> = {}): void {
  document.body.innerHTML = `
    <input id="cb" />
    <ul id="root">
      <li class="option">Apple</li>
      <li class="option">Banana</li>
      <li class="option">Cherry</li>
      <li class="option">Date</li>
    </ul>`;
  instance = tabspot();
  setTabspotAttributes({
    element: byId("root"),
    config: {
      root: { manageSpecialKeys: true },
      mover: {
        axis: "vertical",
        items: ".option",
        activation: { mode: "activedescendant", controller: "#cb" },
        ...mover,
      } as TabspotMoverOptions,
    },
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

describe("setTabspotActive: moving the cursor", () => {
  it("moves the cursor and reports where it came from and went", () => {
    mountCombobox();
    const res = success(setTabspotActive(options()[2]!));
    expect(res.from).toBeNull(); // the cursor started empty
    expect(res.to).toBe(options()[2]);
    expect(res.moved).toBe(true);
    expect(activeText(byId("cb"))).toBe("Cherry");
  });

  it("dispatches a navigation event flagged programmatic, with no key", () => {
    const events: TabspotNavigationEvent[] = [];
    mountCombobox();
    instance.subscribe((e) => events.push(e));
    setTabspotActive(options()[1]!);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.direction).toBe("programmatic");
    expect(ev.key).toBe("");
    expect(ev.from).toBeNull();
    expect(ev.to).toBe(options()[1]);
    expect(ev.toIndex).toBe(1);
    expect(ev.level).toBe(0);
    expect(ev.root).toBe(byId("root"));
    expect(ev.atEdge).toBeUndefined();
    expect(ev.atRenderedBoundary).toBeUndefined();
  });

  it("carries the previous item as `from` on a second move", () => {
    const events: TabspotNavigationEvent[] = [];
    mountCombobox();
    setTabspotActive(options()[0]!);
    instance.subscribe((e) => events.push(e));
    const res = success(setTabspotActive(options()[3]!));
    expect(res.from).toBe(options()[0]);
    expect(events[0]!.from).toBe(options()[0]);
    expect(events[0]!.fromIndex).toBe(0);
  });

  it("lets the caller override the reported direction", () => {
    const events: TabspotNavigationEvent[] = [];
    mountCombobox();
    instance.subscribe((e) => events.push(e));
    setTabspotActive(options()[1]!, { direction: "down" });
    expect(events[0]!.direction).toBe("down");
  });

  it("is idempotent on the item the cursor is already on — no event", () => {
    const events: TabspotNavigationEvent[] = [];
    mountCombobox();
    setTabspotActive(options()[2]!);
    instance.subscribe((e) => events.push(e));
    const res = success(setTabspotActive(options()[2]!));
    expect(res.moved).toBe(false);
    expect(res.from).toBe(options()[2]);
    expect(res.to).toBe(options()[2]);
    expect(events).toEqual([]);
  });

  it("THE POINT: arrows continue from the programmatic position", () => {
    mountCombobox();
    setTabspotActive(options()[1]!); // Banana
    press(byId("cb"), "ArrowDown");
    expect(activeText(byId("cb"))).toBe("Cherry");
    press(byId("cb"), "ArrowUp");
    expect(activeText(byId("cb"))).toBe("Banana");
  });

  it("Home/End also continue from the programmatic position", () => {
    mountCombobox();
    setTabspotActive(options()[2]!);
    press(byId("cb"), "End");
    expect(activeText(byId("cb"))).toBe("Date");
    press(byId("cb"), "Home");
    expect(activeText(byId("cb"))).toBe("Apple");
  });

  it("pairs with clearTabspotActive", () => {
    mountCombobox();
    setTabspotActive(options()[1]!);
    expect(byId("cb").getAttribute("aria-activedescendant")).not.toBeNull();
    expect(clearTabspotActive(byId("root"))).toBe(true);
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
    // And the cursor is empty again, so the next arrow ENTERS rather than moves.
    press(byId("cb"), "ArrowDown");
    expect(activeText(byId("cb"))).toBe("Apple");
  });
});

// ---------------------------------------------------------------------------

describe("setTabspotActive: the other activation modes", () => {
  it("marked: moves the mark and clears the previous one", () => {
    document.body.innerHTML = `
      <ul id="root">
        <li class="option">Apple</li>
        <li class="option">Banana</li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical", items: ".option", activation: "marked" } },
    });
    setTabspotActive(options()[0]!);
    expect(options()[0]!.getAttribute("data-active")).toBe("true");
    setTabspotActive(options()[1]!);
    expect(options()[0]!.hasAttribute("data-active")).toBe(false);
    expect(options()[1]!.getAttribute("data-active")).toBe("true");
  });

  it("controlled: tracks the cursor with no DOM mutation, and arrows continue", () => {
    const events: TabspotNavigationEvent[] = [];
    document.body.innerHTML = `
      <ul id="root">
        <li class="option">Apple</li>
        <li class="option">Banana</li>
        <li class="option">Cherry</li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical", items: ".option", activation: "controlled" } },
    });
    const before = options().map((el) => el.outerHTML);
    setTabspotActive(options()[1]!);
    // `controlled` writes nothing: no mark, no generated id, no aria-activedescendant
    // anywhere — the cursor is tracked in memory only.
    expect(options().map((el) => el.outerHTML)).toEqual(before);
    expect(document.querySelector("[aria-activedescendant]")).toBeNull();
    instance.subscribe((e) => events.push(e));
    press(byId("root"), "ArrowDown");
    expect(events).toHaveLength(1);
    expect(events[0]!.from).toBe(options()[1]);
    expect(events[0]!.to).toBe(options()[2]);
  });

  it("refuses a `focus` root — there the cursor is DOM focus", () => {
    document.body.innerHTML = `
      <ul id="root"><li tabindex="0">a</li><li tabindex="-1">b</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical" } },
    });
    const li = byId("root").children[1] as HTMLElement;
    const res = refusal(setTabspotActive(li));
    expect(res.reason).toBe("focus-mode");
    expect(res.message).toContain("el.focus()");
  });
});

// ---------------------------------------------------------------------------

describe("setTabspotActive: refusals", () => {
  it("no-root: an element outside every registered root", () => {
    mountCombobox();
    document.body.insertAdjacentHTML("beforeend", `<div id="outside">nope</div>`);
    const res = refusal(setTabspotActive(byId("outside")));
    expect(res.reason).toBe("no-root");
  });

  it("no-root: a detached element (a stale ref across a re-render)", () => {
    mountCombobox();
    const stale = options()[1]!;
    stale.remove();
    const res = refusal(setTabspotActive(stale));
    expect(res.reason).toBe("no-root");
    expect(res.message).toContain("not in the document");
  });

  it("not-an-item: inside the root but outside the items selector", () => {
    mountCombobox();
    byId("root").insertAdjacentHTML("beforeend", `<li id="hdr" class="header">Group</li>`);
    const res = refusal(setTabspotActive(byId("hdr")));
    expect(res.reason).toBe("not-an-item");
  });

  it("cancelled: a listener vetoes the move and the cursor stays put", () => {
    mountCombobox();
    setTabspotActive(options()[0]!);
    const off = instance.subscribe((e) => e.preventDefault());
    const res = refusal(setTabspotActive(options()[2]!));
    expect(res.reason).toBe("cancelled");
    expect(activeText(byId("cb"))).toBe("Apple"); // unmoved
    off();
    expect(success(setTabspotActive(options()[2]!)).moved).toBe(true);
  });

  it("reentrant: refused from inside a navigation listener, and does not loop", () => {
    const results: SetActiveResult[] = [];
    mountCombobox();
    let attempts = 0;
    // A counter caps the damage so a broken guard fails the assertion instead of
    // hanging the suite.
    instance.subscribe(() => {
      if (attempts++ >= 5) return;
      results.push(setTabspotActive(options()[3]!));
    });
    press(byId("cb"), "ArrowDown"); // entry -> Apple, fires the listener
    expect(attempts).toBe(1);
    expect(refusal(results[0]!).reason).toBe("reentrant");
    expect(results[0]!.ok).toBe(false);
    // The keyed move still landed; the re-entrant one simply did nothing.
    expect(activeText(byId("cb"))).toBe("Apple");
  });

  it("the documented way to redirect: preventDefault, then move after the dispatch", () => {
    mountCombobox();
    const off = instance.subscribe((e) => {
      if (e.to === options()[0]) e.preventDefault();
    });
    press(byId("cb"), "ArrowDown"); // vetoed
    expect(activeText(byId("cb"))).toBeNull();
    off();
    expect(success(setTabspotActive(options()[1]!)).to).toBe(options()[1]);
    expect(activeText(byId("cb"))).toBe("Banana");
  });

  it("no-root when Tabspot is not running", () => {
    mountCombobox();
    const el = options()[1]!;
    instance.destroy();
    const res = refusal(setTabspotActive(el));
    expect(res.reason).toBe("no-root");
    expect(res.message).toContain("not running");
    instance = tabspot(); // afterEach destroys it
  });
});

// ---------------------------------------------------------------------------

describe("setTabspotActive: skip and `nearest`", () => {
  function mountWithSkip(skipped: readonly number[]): void {
    const names = ["Apple", "Banana", "Cherry", "Date"];
    document.body.innerHTML = `
      <input id="cb" />
      <ul id="root">${names
        .map(
          (n, i) =>
            `<li class="option"${skipped.includes(i) ? ` aria-disabled="true"` : ""}>${n}</li>`,
        )
        .join("")}</ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
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
  }

  it("refuses a skipped item by default", () => {
    mountWithSkip([1]);
    const res = refusal(setTabspotActive(options()[1]!));
    expect(res.reason).toBe("skipped");
    expect(res.message).toContain("nearest");
    expect(activeText(byId("cb"))).toBeNull();
  });

  it("nearest: lands on the next landable item forward", () => {
    mountWithSkip([1, 2]);
    const res = success(setTabspotActive(options()[1]!, { nearest: true }));
    expect(res.to).toBe(options()[3]); // 1 and 2 skipped -> Date
    expect(activeText(byId("cb"))).toBe("Date");
  });

  it("nearest: falls back backward when nothing landable lies forward", () => {
    mountWithSkip([2, 3]);
    const res = success(setTabspotActive(options()[3]!, { nearest: true }));
    expect(res.to).toBe(options()[1]); // nothing after 3 -> back to Banana
  });

  it("nearest: returns the item itself when it is landable", () => {
    mountWithSkip([0]);
    expect(success(setTabspotActive(options()[2]!, { nearest: true })).to).toBe(options()[2]);
  });

  it("nearest: still refuses when the whole level is skipped", () => {
    mountWithSkip([0, 1, 2, 3]);
    expect(refusal(setTabspotActive(options()[0]!, { nearest: true })).reason).toBe("skipped");
  });

  it("arrows keep skipping after a programmatic landing", () => {
    mountWithSkip([2]);
    setTabspotActive(options()[1]!);
    press(byId("cb"), "ArrowDown"); // 2 is skipped -> Date
    expect(activeText(byId("cb"))).toBe("Date");
  });
});

// ---------------------------------------------------------------------------

describe("setTabspotActive: interaction with the rest of the engine", () => {
  it("recompiles a dirty root, so an item added after the last build works", async () => {
    mountCombobox();
    byId("root").insertAdjacentHTML("beforeend", `<li class="option">Elderberry</li>`);
    await tick(); // let the DOM reactor mark the root dirty
    const added = options()[4]!;
    const res = success(setTabspotActive(added));
    expect(res.to).toBe(added);
    expect(activeText(byId("cb"))).toBe("Elderberry");
  });

  it("lands inside a grouper with the right level, and Escape still exits it", () => {
    document.body.innerHTML = `
      <input id="cb" />
      <ul id="root">
        <li class="option">Apple</li>
        <li class="option">Banana</li>
        <ul id="sub" data-tabspot='{"grouper":{"enterDirection":"right","exitDirection":"left"}}'>
          <li class="option">Sub 1</li>
          <li class="option">Sub 2</li>
        </ul>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: {
        root: { manageSpecialKeys: true },
        mover: {
          axis: "vertical",
          items: ".option",
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });
    const events: TabspotNavigationEvent[] = [];
    const sub2 = byId("sub").children[1] as HTMLElement;
    const res = success(setTabspotActive(sub2));
    expect(res.to).toBe(sub2);
    instance.subscribe((e) => events.push(e));
    // Escape resolves the enclosing grouper from the node, so it exits to the
    // grouper's anchor — the programmatic landing did not break the hierarchy.
    press(byId("cb"), "Escape");
    expect(events).toHaveLength(1);
    expect(events[0]!.direction).toBe("escape");
    expect(events[0]!.to).toBe(options()[1]); // anchor = Banana
  });

  it("a grid root gets the grid payload in the event", () => {
    document.body.innerHTML = `
      <input id="cb" />
      <table id="root"><tbody>
        <tr><td class="c">0,0</td><td class="c">0,1</td></tr>
        <tr><td class="c">1,0</td><td class="c">1,1</td></tr>
      </tbody></table>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: {
        root: {},
        mover: {
          layout: "grid",
          items: ".c",
          rows: { by: "selector", row: "tr" },
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });
    const events: TabspotNavigationEvent[] = [];
    instance.subscribe((e) => events.push(e));
    const cell = document.querySelectorAll<HTMLElement>(".c")[3]!; // 1,1
    success(setTabspotActive(cell));
    expect(events[0]!.grid?.to).toEqual({ row: 1, col: 1 });
    // And a grid arrow continues from there.
    press(byId("cb"), "ArrowUp");
    expect(activeText(byId("cb"))).toBe("0,1");
  });

  it("works on a virtualized root and the virtual boundary still resolves after", async () => {
    const TOTAL = 50;
    document.body.innerHTML = `<input id="cb" /><ul id="root"></ul>`;
    const root = byId("root");
    const render = (i: number): void => {
      if (i < 0 || i >= TOTAL || root.querySelector(`[data-index="${i}"]`)) return;
      const li = document.createElement("li");
      li.setAttribute("data-index", String(i));
      li.className = "option";
      li.textContent = `row ${i}`;
      const after = Array.from(root.children).find((c) => Number(c.getAttribute("data-index")) > i);
      root.insertBefore(li, after ?? null);
    };
    for (const i of [10, 11, 12]) render(i);
    instance = tabspot();
    setTabspotAttributes({
      element: root,
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: ".option",
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });
    detach = tabspotVirtual(root, { count: () => TOTAL, scrollToIndex: (i) => render(i) });

    const rendered = root.querySelector('[data-index="12"]') as HTMLElement;
    expect(success(setTabspotActive(rendered)).to).toBe(rendered);
    // From the last rendered row, the arrow hands off to the virtual walk.
    press(byId("cb"), "ArrowDown");
    await tick(120);
    expect(activeText(byId("cb"))).toBe("row 13");
  });
});

// ---------------------------------------------------------------------------
// Many widgets on one page: the root is derived from the item, never ambient
// ---------------------------------------------------------------------------

describe("setTabspotActive: targeting one widget among many", () => {
  const COUNT = 200;

  /** `COUNT` independent comboboxes, each with its own controller and options. */
  function mountMany(): void {
    document.body.innerHTML = Array.from(
      { length: COUNT },
      (_, n) => `
        <input id="cb-${n}" />
        <ul id="root-${n}">
          <li class="option">A-${n}</li>
          <li class="option">B-${n}</li>
          <li class="option">C-${n}</li>
        </ul>`,
    ).join("");
    instance = tabspot();
    for (let n = 0; n < COUNT; n++) {
      setTabspotAttributes({
        element: byId(`root-${n}`),
        config: {
          root: {},
          mover: {
            axis: "vertical",
            items: ".option",
            activation: { mode: "activedescendant", controller: `#cb-${n}` },
          },
        },
      });
    }
  }
  const optionsOf = (n: number): HTMLElement[] =>
    Array.from(byId(`root-${n}`).querySelectorAll<HTMLElement>(".option"));

  it("drives only the widget the item belongs to, and reports which root that was", () => {
    mountMany();
    const target = optionsOf(115)[1]!; // B-115
    const res = success(setTabspotActive(target));

    expect(res.root).toBe(byId("root-115"));
    expect(res.to).toBe(target);
    expect(activeText(byId("cb-115"))).toBe("B-115");
    // Every other controller is untouched — no ambient "current root" to leak into.
    const touched = Array.from(document.querySelectorAll("[aria-activedescendant]"));
    expect(touched).toEqual([byId("cb-115")]);
  });

  it("scopes the event to that root, so a per-root subscriber hears only its own", () => {
    const mine: TabspotNavigationEvent[] = [];
    const neighbour: TabspotNavigationEvent[] = [];
    mountMany();
    instance.subscribe(byId("root-115"), (e) => mine.push(e));
    instance.subscribe(byId("root-116"), (e) => neighbour.push(e));
    setTabspotActive(optionsOf(115)[2]!);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.root).toBe(byId("root-115"));
    expect(neighbour).toEqual([]);
  });

  it("keeps a cursor per root — moving one does not disturb another", () => {
    mountMany();
    setTabspotActive(optionsOf(3)[0]!);
    setTabspotActive(optionsOf(115)[1]!);
    setTabspotActive(optionsOf(199)[2]!);
    expect(activeText(byId("cb-3"))).toBe("A-3");
    expect(activeText(byId("cb-115"))).toBe("B-115");
    expect(activeText(byId("cb-199"))).toBe("C-199");
    // And arrows in one continue from that root's own cursor.
    press(byId("cb-115"), "ArrowDown");
    expect(activeText(byId("cb-115"))).toBe("C-115");
    expect(activeText(byId("cb-3"))).toBe("A-3"); // still put
  });

  it("clearing one root leaves the others alone", () => {
    mountMany();
    setTabspotActive(optionsOf(115)[0]!);
    setTabspotActive(optionsOf(116)[0]!);
    clearTabspotActive(byId("root-115"));
    expect(activeText(byId("cb-115"))).toBeNull();
    expect(activeText(byId("cb-116"))).toBe("A-116");
  });

  it("an item from a root that was never registered is refused, not misrouted", () => {
    mountMany();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<ul id="loose"><li class="option">Loose</li></ul>`,
    );
    const loose = byId("loose").querySelector<HTMLElement>(".option")!;
    expect(refusal(setTabspotActive(loose)).reason).toBe("no-root");
    // Nothing was driven as a side effect.
    expect(document.querySelectorAll("[aria-activedescendant]")).toHaveLength(0);
  });
});
