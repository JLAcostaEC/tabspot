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

describe("group inside item — ARIA tree (explicit enter/exit)", () => {
  // The navigable item is the `<li role="treeitem">` itself; the `<span>` is a
  // plain label and the nested `<ul role="group">` is the item's subgroup.
  function mount(): void {
    document.body.innerHTML = `
      <ul id="tree" role="tree"
          data-tabspot='{"root":{},"mover":{"axis":"vertical","items":"li.item"}}'>
        <li id="toppings" role="treeitem" aria-expanded="false" class="item">
          <span>Pizza Toppings</span>
          <ul id="group" role="group"
              data-tabspot='{"grouper":{"enterDirection":"right","exitDirection":"left"},"mover":{"axis":"vertical","items":"li"}}'>
            <li id="cheese" role="treeitem">Cheese</li>
            <li id="pepperoni" role="treeitem">Pepperoni</li>
            <li id="onion" role="treeitem">Onion</li>
          </ul>
        </li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("tree"),
      config: { root: {}, mover: { axis: "vertical", items: "li.item" } },
    });
  }

  it("treats the treeitem as the item and the group children as a subgroup", () => {
    mount();
    // The label stays a plain span (never focusable / never a tab stop).
    expect(byId("toppings").querySelector("span")!.getAttribute("tabindex")).toBeNull();
    // Roving grants focusability: parent is the tab stop, subgroup items demoted.
    expect(byId("toppings").getAttribute("tabindex")).toBe("0");
    expect(byId("cheese").getAttribute("tabindex")).toBe("-1");
    expect(byId("pepperoni").getAttribute("tabindex")).toBe("-1");
    expect(byId("onion").getAttribute("tabindex")).toBe("-1");
  });

  it("enters the subgroup with the configured enterDirection (ArrowRight)", () => {
    mount();
    press(byId("toppings"), "ArrowRight");
    expect(document.activeElement).toBe(byId("cheese"));
  });

  it("navigates within the subgroup along its own axis", () => {
    mount();
    press(byId("cheese"), "ArrowDown");
    expect(document.activeElement).toBe(byId("pepperoni"));
    press(byId("pepperoni"), "ArrowDown");
    expect(document.activeElement).toBe(byId("onion"));
  });

  it("exits back to the owning item with the configured exitDirection (ArrowLeft)", () => {
    mount();
    press(byId("pepperoni"), "ArrowLeft");
    expect(document.activeElement).toBe(byId("toppings"));
  });

  it("does not descend into the subgroup along the parent axis", () => {
    mount();
    // ArrowDown is the parent's axis: with no parent sibling it must NOT fall
    // into the subgroup — the group is only reachable via enterDirection.
    press(byId("toppings"), "ArrowDown");
    expect(document.activeElement).toBe(byId("toppings"));
  });
});

describe("group inside item — cross-axis fallback (no enter/exit declared)", () => {
  // Horizontal parent, vertical subgroup: the cross-axis (vertical) doubles as
  // the implicit enter gesture, so `grouper: {}` needs no directions.
  function mount(): void {
    document.body.innerHTML = `
      <ul id="bar" data-tabspot='{"root":{},"mover":{"axis":"horizontal","items":"li.item"}}'>
        <li id="a" class="item" tabindex="0">A</li>
        <li id="b" class="item" tabindex="0">B
          <ul id="bsub" data-tabspot='{"grouper":{},"mover":{"axis":"vertical","items":"li.sub"}}'>
            <li id="b1" class="sub">B1</li>
            <li id="b2" class="sub">B2</li>
          </ul>
        </li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("bar"),
      config: { root: {}, mover: { axis: "horizontal", items: "li.item" } },
    });
  }

  it("enters the subgroup by pressing in the subgroup's axis", () => {
    mount();
    press(byId("b"), "ArrowDown");
    expect(document.activeElement).toBe(byId("b1"));
  });

  it("exits the subgroup by pressing the cross-axis", () => {
    mount();
    press(byId("b1"), "ArrowLeft");
    expect(document.activeElement).toBe(byId("b"));
  });

  it("keeps parent siblings reachable along the parent axis", () => {
    mount();
    press(byId("a"), "ArrowRight");
    expect(document.activeElement).toBe(byId("b"));
  });
});
