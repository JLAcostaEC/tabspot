import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearTabspotActive,
  setTabspotAttributes,
  tabspot,
  unsetTabspotSection,
} from "../index.ts";
import type { TabspotInstance, TabspotNavigationEvent, TabspotNodeOptions } from "../index.ts";

let instance: TabspotInstance;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}
/** Id of the item currently carrying the default `marked` marker, if any. */
function active(): string | null {
  return document.querySelector<HTMLElement>("[data-active]")?.id ?? null;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  instance.destroy();
  document.body.innerHTML = "";
});

describe("activation: marked (mark the active item, no focus move)", () => {
  function mountWith(activation: unknown): void {
    document.body.innerHTML = `<ul id="root"><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: {
        root: {},
        mover: { axis: "vertical", items: "li", activation: activation as never },
      },
    });
  }

  it("marks nothing on register — the cursor starts empty", () => {
    mountWith("marked");
    expect(byId("a").getAttribute("data-active")).toBeNull();
    expect(byId("b").getAttribute("data-active")).toBeNull();
    expect(byId("c").getAttribute("data-active")).toBeNull();
  });

  it('shorthand "marked" defaults to data-active, entering on the first item', () => {
    mountWith("marked");
    const before = document.activeElement;
    key(byId("root"), "ArrowDown"); // enters the list
    expect(byId("a").getAttribute("data-active")).toBe("true");
    key(byId("root"), "ArrowDown"); // moves within it
    expect(byId("a").getAttribute("data-active")).toBeNull();
    expect(byId("b").getAttribute("data-active")).toBe("true");
    expect(document.activeElement).toBe(before); // focus did not move
  });

  it("mark can be an attribute", () => {
    mountWith({ mode: "marked", mark: { attribute: "data-current" } });
    key(byId("root"), "ArrowDown");
    expect(byId("a").getAttribute("data-current")).toBe("true");
    key(byId("root"), "ArrowDown");
    expect(byId("b").getAttribute("data-current")).toBe("true");
    expect(byId("a").getAttribute("data-current")).toBeNull();
  });

  it("mark can be a class", () => {
    mountWith({ mode: "marked", mark: { class: "is-active" } });
    key(byId("root"), "ArrowDown");
    expect(byId("a").classList.contains("is-active")).toBe(true);
    key(byId("root"), "ArrowDown");
    expect(byId("b").classList.contains("is-active")).toBe(true);
    expect(byId("a").classList.contains("is-active")).toBe(false);
  });

  it("clears the mark on destroy", () => {
    mountWith({ mode: "marked", mark: { class: "is-active" } });
    key(byId("root"), "ArrowDown");
    expect(byId("a").classList.contains("is-active")).toBe(true);
    instance.destroy();
    expect(byId("a").classList.contains("is-active")).toBe(false);
  });
});

describe("activation: activedescendant (controller keeps focus)", () => {
  function mount(): void {
    document.body.innerHTML = `
      <input id="cb" />
      <ul id="lb"><li id="o1">A</li><li id="o2">B</li><li id="o3">C</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("lb"),
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: "li",
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });
  }

  it("publishes no aria-activedescendant on register", () => {
    mount();
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
  });

  it("ArrowDown (on the controller) enters on the first option, then advances", () => {
    mount();
    byId("cb").focus();
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o2");
    expect(document.activeElement).toBe(byId("cb"));
  });

  it("ArrowUp enters on the LAST option (backward entry from outside)", () => {
    mount();
    byId("cb").focus();
    key(byId("cb"), "ArrowUp");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o3");
    key(byId("cb"), "ArrowUp");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o2");
  });

  it("re-registering the root does not re-seed a cursor", () => {
    const config: TabspotNodeOptions = {
      root: {},
      mover: {
        axis: "vertical",
        items: "li",
        activation: { mode: "activedescendant", controller: "#cb" },
      },
    };
    mount();
    setTabspotAttributes({ element: byId("lb"), config });
    setTabspotAttributes({ element: byId("lb"), config });
    instance.rebuild();
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
  });

  it("clears aria-activedescendant on destroy", () => {
    mount();
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
    instance.destroy();
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
  });

  it("drops a cursor whose item left the item set on the next build", () => {
    mount();
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
    // Narrow `items`: the active <li> is no longer navigable.
    setTabspotAttributes({
      element: byId("lb"),
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: "li.opt",
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
  });
});

describe("activation: activedescendant + mark (mark the active option too)", () => {
  function mount(): void {
    document.body.innerHTML = `
      <input id="cb" />
      <ul id="lb"><li id="o1">A</li><li id="o2">B</li><li id="o3">C</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("lb"),
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: "li",
          activation: {
            mode: "activedescendant",
            controller: "#cb",
            mark: { attribute: "aria-selected" },
          },
        },
      },
    });
  }

  it("marks no option on register (nothing is announced as chosen)", () => {
    mount();
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
    expect(byId("o1").getAttribute("aria-selected")).toBeNull();
  });

  it("moves the marker with the active option, focus staying on the controller", () => {
    mount();
    byId("cb").focus();
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
    expect(byId("o1").getAttribute("aria-selected")).toBe("true");
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o2");
    expect(byId("o2").getAttribute("aria-selected")).toBe("true");
    expect(byId("o1").getAttribute("aria-selected")).toBeNull();
    expect(document.activeElement).toBe(byId("cb"));
  });

  it("clears the marker on destroy", () => {
    mount();
    key(byId("cb"), "ArrowDown");
    expect(byId("o1").getAttribute("aria-selected")).toBe("true");
    instance.destroy();
    expect(byId("o1").getAttribute("aria-selected")).toBeNull();
  });
});

describe("activation: controlled (event only, no DOM mutation)", () => {
  function mount(events: TabspotNavigationEvent[], root: TabspotNodeOptions["root"] = {}): void {
    document.body.innerHTML = `<ul id="root"><li id="a">A</li><li id="b">B</li></ul>`;
    instance = tabspot({ onNavigate: (e) => events.push(e) });
    setTabspotAttributes({
      element: byId("root"),
      config: { root, mover: { axis: "vertical", items: "li", activation: "controlled" } },
    });
  }

  it("emits the entry move with a null origin, then normal moves", () => {
    const events: TabspotNavigationEvent[] = [];
    mount(events);

    const before = document.activeElement;
    key(byId("root"), "ArrowDown");

    expect(events.at(-1)?.direction).toBe("down");
    expect(events.at(-1)?.from).toBeNull();
    expect(events.at(-1)?.fromIndex).toBeUndefined();
    expect(events.at(-1)?.to).toBe(byId("a"));
    expect(events.at(-1)?.toIndex).toBe(0);

    key(byId("root"), "ArrowDown");
    expect(events.at(-1)?.fromIndex).toBe(0);
    expect(events.at(-1)?.toIndex).toBe(1);

    expect(byId("b").getAttribute("aria-selected")).toBeNull(); // no marker in controlled
    expect(document.activeElement).toBe(before); // no focus move
  });

  it("preventDefault() on the entry event leaves the cursor empty", () => {
    const events: TabspotNavigationEvent[] = [];
    document.body.innerHTML = `<ul id="root"><li id="a">A</li><li id="b">B</li></ul>`;
    instance = tabspot({
      onNavigate: (e) => {
        events.push(e);
        e.preventDefault();
      },
    });
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical", items: "li", activation: "controlled" } },
    });

    key(byId("root"), "ArrowDown");
    key(byId("root"), "ArrowDown");
    // Both presses re-enter (the cancelled entry never committed a cursor).
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.from === null && e.to === byId("a"))).toBe(true);
  });

  it("Home / End enter on the first / last item when the root manages them", () => {
    const events: TabspotNavigationEvent[] = [];
    mount(events, { manageSpecialKeys: true });

    key(byId("root"), "End");
    expect(events.at(-1)?.direction).toBe("end");
    expect(events.at(-1)?.from).toBeNull();
    expect(events.at(-1)?.to).toBe(byId("b"));

    clearTabspotActive(byId("root"));
    key(byId("root"), "Home");
    expect(events.at(-1)?.direction).toBe("home");
    expect(events.at(-1)?.from).toBeNull();
    expect(events.at(-1)?.to).toBe(byId("a"));
  });

  it("Home / End are inert when the root does not manage them", () => {
    const events: TabspotNavigationEvent[] = [];
    mount(events);
    key(byId("root"), "Home");
    key(byId("root"), "End");
    expect(events).toHaveLength(0);
  });
});

describe("entry from outside: axis, RTL and ignoreKeys", () => {
  function mount(mover: TabspotNodeOptions["mover"], rtl = false): void {
    document.body.innerHTML = `<ul id="root" ${rtl ? 'dir="rtl"' : ""}>
      <li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({ element: byId("root"), config: { root: {}, mover } });
  }

  it("a linear mover ignores the cross axis (no entry on ArrowDown for horizontal)", () => {
    mount({ axis: "horizontal", items: "li", activation: "marked" });
    key(byId("root"), "ArrowDown");
    expect(active()).toBeNull();
    key(byId("root"), "ArrowRight");
    expect(active()).toBe("a");
  });

  it("backward on the mover's axis enters on the last item", () => {
    mount({ axis: "horizontal", items: "li", activation: "marked" });
    key(byId("root"), "ArrowLeft");
    expect(active()).toBe("c");
  });

  it("RTL mirrors the horizontal entry", () => {
    mount({ axis: "horizontal", items: "li", activation: "marked" }, true);
    key(byId("root"), "ArrowLeft"); // forward under RTL
    expect(active()).toBe("a");
  });

  it("ignoreKeys opts the entry out too", () => {
    mount({ axis: "vertical", items: "li", activation: "marked", ignoreKeys: ["ArrowDown"] });
    key(byId("root"), "ArrowDown");
    expect(active()).toBeNull();
    key(byId("root"), "ArrowUp");
    expect(active()).toBe("c");
  });

  it("a focus root is not entered by an arrow (Tab is its entry point)", () => {
    document.body.innerHTML = `<ul id="root"><li id="a" tabindex="-1">A</li><li id="b" tabindex="-1">B</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical" } },
    });
    const before = document.activeElement;
    key(byId("root"), "ArrowDown");
    expect(document.activeElement).toBe(before);
  });
});

describe("clearTabspotActive", () => {
  function mount(): void {
    document.body.innerHTML = `
      <input id="cb" />
      <ul id="lb"><li id="o1">A</li><li id="o2">B</li><li id="o3">C</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("lb"),
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: "li",
          activation: {
            mode: "activedescendant",
            controller: "#cb",
            mark: { attribute: "aria-selected" },
          },
        },
      },
    });
  }

  it("empties the cursor and clears everything it published", () => {
    mount();
    key(byId("cb"), "ArrowDown");
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o2");

    expect(clearTabspotActive(byId("lb"))).toBe(true);
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();
    expect(byId("o2").getAttribute("aria-selected")).toBeNull();
  });

  it("leaves the root registered — the next arrow enters from outside again", () => {
    mount();
    key(byId("cb"), "ArrowDown");
    key(byId("cb"), "ArrowDown");
    clearTabspotActive(byId("lb"));
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
  });

  it("returns false for a focus root and for an unregistered element", () => {
    document.body.innerHTML = `<ul id="root"><li id="a" tabindex="-1">A</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical" } },
    });
    expect(clearTabspotActive(byId("root"))).toBe(false); // focus activation
    expect(clearTabspotActive(byId("a"))).toBe(false); // not a root
  });
});

describe("issue #15: a non-focus root must not seed a cursor on registration", () => {
  // The reporter's exact sequence: register → unregister → key → register again.
  const CONFIG: TabspotNodeOptions = {
    root: {},
    mover: {
      axis: "vertical",
      items: "[role=option]",
      activation: {
        mode: "activedescendant",
        controller: "#q",
        mark: { attribute: "data-active" },
      },
    },
  };
  const ad = (): string | null => byId("q").getAttribute("aria-activedescendant");

  it("publishes nothing until a key is pressed, and the first ArrowDown lands on Apple", () => {
    document.body.innerHTML = `
      <input id="q" role="combobox" aria-controls="list" aria-expanded="true" />
      <ul id="list" role="listbox">
        <li role="option" id="opt-apple">Apple</li>
        <li role="option" id="opt-banana">Banana</li>
        <li role="option" id="opt-cherry">Cherry</li>
      </ul>`;
    const list = byId("list");

    instance = tabspot();
    expect(ad()).toBeNull(); // after tabspot()

    setTabspotAttributes({ element: list, config: CONFIG });
    expect(ad()).toBeNull(); // after registering the root, no interaction
    expect(byId("opt-apple").getAttribute("data-active")).toBeNull();

    unsetTabspotSection(list, "root");
    expect(ad()).toBeNull();

    byId("q").focus();
    key(byId("q"), "ArrowDown"); // no root: nothing moves
    expect(ad()).toBeNull();

    setTabspotAttributes({ element: list, config: CONFIG });
    expect(ad()).toBeNull(); // no seed on re-registration either

    key(byId("q"), "ArrowDown");
    expect(ad()).toBe("opt-apple"); // enters the list, does NOT skip to Banana
    expect(byId("opt-apple").getAttribute("data-active")).toBe("true");
  });
});

describe("a non-focus root takes keys only from its activation controller", () => {
  it("ignores arrows pressed inside an unrelated descendant (activedescendant)", () => {
    document.body.innerHTML = `
      <input id="cb" />
      <ul id="lb">
        <li id="o1">A</li>
        <li id="o2">B</li>
        <li><input id="filter" /></li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("lb"),
      config: {
        root: {},
        mover: {
          axis: "vertical",
          items: "li",
          activation: { mode: "activedescendant", controller: "#cb" },
        },
      },
    });

    // Entry does not fire from the inner input…
    byId("filter").focus();
    key(byId("filter"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBeNull();

    // …nor does a move once the controller has set a cursor.
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
    key(byId("filter"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
  });

  it("in marked/controlled the controller is the root element itself", () => {
    document.body.innerHTML = `
      <ul id="root">
        <li id="a">A</li>
        <li id="b">B</li>
        <li><input id="filter" /></li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical", items: "li", activation: "marked" } },
    });

    key(byId("filter"), "ArrowDown");
    expect(active()).toBeNull(); // the input owns its arrows

    key(byId("root"), "ArrowDown");
    expect(active()).toBe("a"); // the root does drive the list
    key(byId("filter"), "ArrowDown");
    expect(active()).toBe("a"); // still parked where the root left it
  });

  it("leaves focus roots alone (their cursor already follows the target)", () => {
    document.body.innerHTML = `
      <ul id="root"><li id="a" tabindex="0">A</li><li id="b" tabindex="-1">B</li></ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: { root: {}, mover: { axis: "vertical" } },
    });
    byId("a").focus();
    key(byId("a"), "ArrowDown");
    expect(document.activeElement).toBe(byId("b"));
  });
});
