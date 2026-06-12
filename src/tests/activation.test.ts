import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
import type { TabspotInstance, TabspotNavigationEvent, TabspotNodeOptions } from "../index.ts";

let instance: TabspotInstance;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
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

  it('shorthand "marked" defaults to data-active on the active item', () => {
    mountWith("marked");
    expect(byId("a").getAttribute("data-active")).toBe("true");
    const before = document.activeElement;
    key(byId("root"), "ArrowDown");
    expect(byId("a").getAttribute("data-active")).toBeNull();
    expect(byId("b").getAttribute("data-active")).toBe("true");
    expect(document.activeElement).toBe(before); // focus did not move
  });

  it("mark can be an attribute", () => {
    mountWith({ mode: "marked", mark: { attribute: "data-current" } });
    expect(byId("a").getAttribute("data-current")).toBe("true");
    key(byId("root"), "ArrowDown");
    expect(byId("b").getAttribute("data-current")).toBe("true");
    expect(byId("a").getAttribute("data-current")).toBeNull();
  });

  it("mark can be a class", () => {
    mountWith({ mode: "marked", mark: { class: "is-active" } });
    expect(byId("a").classList.contains("is-active")).toBe(true);
    key(byId("root"), "ArrowDown");
    expect(byId("b").classList.contains("is-active")).toBe(true);
    expect(byId("a").classList.contains("is-active")).toBe(false);
  });

  it("clears the mark on destroy", () => {
    mountWith({ mode: "marked", mark: { class: "is-active" } });
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

  it("points aria-activedescendant at the first option on register", () => {
    mount();
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
  });

  it("ArrowDown (on the controller) advances aria-activedescendant; focus stays on controller", () => {
    mount();
    byId("cb").focus();
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o2");
    expect(document.activeElement).toBe(byId("cb"));
  });

  it("clears aria-activedescendant on destroy", () => {
    mount();
    instance.destroy();
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

  it("marks the first option on register (+ controller's aria-activedescendant)", () => {
    mount();
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o1");
    expect(byId("o1").getAttribute("aria-selected")).toBe("true");
    expect(byId("o2").getAttribute("aria-selected")).toBeNull();
  });

  it("moves the marker with the active option, focus staying on the controller", () => {
    mount();
    byId("cb").focus();
    key(byId("cb"), "ArrowDown");
    expect(byId("cb").getAttribute("aria-activedescendant")).toBe("o2");
    expect(byId("o2").getAttribute("aria-selected")).toBe("true");
    expect(byId("o1").getAttribute("aria-selected")).toBeNull();
    expect(document.activeElement).toBe(byId("cb"));
  });

  it("clears the marker on destroy", () => {
    mount();
    instance.destroy();
    expect(byId("o1").getAttribute("aria-selected")).toBeNull();
  });
});

describe("activation: controlled (event only, no DOM mutation)", () => {
  it("emits onNavigate with toIndex and mutates nothing", () => {
    document.body.innerHTML = `<ul id="root"><li id="a">A</li><li id="b">B</li></ul>`;
    const events: TabspotNavigationEvent[] = [];
    instance = tabspot({ onNavigate: (e) => events.push(e) });
    const config: TabspotNodeOptions = {
      root: {},
      mover: { axis: "vertical", items: "li", activation: "controlled" },
    };
    setTabspotAttributes({ element: byId("root"), config });

    const before = document.activeElement;
    key(byId("root"), "ArrowDown");

    expect(events.at(-1)?.direction).toBe("down");
    expect(events.at(-1)?.toIndex).toBe(1);
    expect(events.at(-1)?.fromIndex).toBe(0);
    expect(byId("b").getAttribute("aria-selected")).toBeNull(); // no marker in controlled
    expect(document.activeElement).toBe(before); // no focus move
  });
});
