import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
import type { TabspotInstance, TabspotNavigationEvent, TabspotNodeOptions } from "../index.ts";

let instance: TabspotInstance;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function press(el: HTMLElement, k: string): KeyboardEvent {
  el.focus();
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** Two independent roots, so per-root filtering has something to filter. */
function mountTwoRoots(opts: Parameters<typeof tabspot>[0] = {}): void {
  document.body.innerHTML = `
    <ul id="one"><li id="a" tabindex="0">A</li><li id="b" tabindex="-1">B</li></ul>
    <ul id="two"><li id="x" tabindex="0">X</li><li id="y" tabindex="-1">Y</li></ul>`;
  instance = tabspot(opts);
  const config: TabspotNodeOptions = { root: {}, mover: { axis: "vertical" } };
  setTabspotAttributes({ element: byId("one"), config });
  setTabspotAttributes({ element: byId("two"), config });
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  instance.destroy();
  document.body.innerHTML = "";
});

describe("subscribe: additive navigation listeners", () => {
  it("does not steal options.onNavigate — both receive the event", () => {
    const fromOptions: string[] = [];
    const fromSub: string[] = [];
    mountTwoRoots({ onNavigate: (e) => fromOptions.push(e.to?.id ?? "") });

    instance.subscribe((e) => fromSub.push(e.to?.id ?? ""));
    press(byId("a"), "ArrowDown");

    expect(fromOptions).toEqual(["b"]);
    expect(fromSub).toEqual(["b"]);
  });

  it("several subscribers all get called", () => {
    const seen: string[] = [];
    mountTwoRoots();
    instance.subscribe(() => seen.push("first"));
    instance.subscribe(() => seen.push("second"));
    press(byId("a"), "ArrowDown");
    expect(seen).toEqual(["first", "second"]);
  });

  it("scoped to a root, it only hears that root", () => {
    const seen: string[] = [];
    mountTwoRoots();
    instance.subscribe(byId("two"), (e) => seen.push(e.to?.id ?? ""));

    press(byId("a"), "ArrowDown"); // root "one" — not ours
    expect(seen).toEqual([]);

    press(byId("x"), "ArrowDown"); // root "two"
    expect(seen).toEqual(["y"]);
  });

  it("the returned detach stops delivery", () => {
    const seen: string[] = [];
    mountTwoRoots();
    const off = instance.subscribe((e) => seen.push(e.to?.id ?? ""));
    press(byId("a"), "ArrowDown");
    off();
    press(byId("b"), "ArrowUp");
    expect(seen).toEqual(["b"]);
  });

  it("a subscriber may detach itself while being notified", () => {
    const seen: string[] = [];
    mountTwoRoots();
    const off = instance.subscribe(() => {
      seen.push("once");
      off();
    });
    press(byId("a"), "ArrowDown");
    press(byId("b"), "ArrowUp");
    expect(seen).toEqual(["once"]);
  });

  it("preventDefault() from a subscriber cancels the move", () => {
    mountTwoRoots();
    instance.subscribe((e) => e.preventDefault());
    press(byId("a"), "ArrowDown");
    expect(document.activeElement).toBe(byId("a")); // never moved
  });

  it("destroy() drops every subscriber", () => {
    const seen: string[] = [];
    mountTwoRoots();
    instance.subscribe(() => seen.push("x"));
    instance.destroy();

    // Re-arm an engine over the same DOM; the old subscriber must be gone.
    instance = tabspot();
    setTabspotAttributes({
      element: byId("one"),
      config: { root: {}, mover: { axis: "vertical" } },
    });
    press(byId("a"), "ArrowDown");
    expect(seen).toEqual([]);
  });
});

describe("edge events: the move ran out of items", () => {
  function mountList(mover: TabspotNodeOptions["mover"]): TabspotNavigationEvent[] {
    const events: TabspotNavigationEvent[] = [];
    document.body.innerHTML = `
      <ul id="root">
        <li id="a" tabindex="0">A</li>
        <li id="b" tabindex="-1">B</li>
        <li id="c" tabindex="-1">C</li>
      </ul>`;
    instance = tabspot();
    setTabspotAttributes({ element: byId("root"), config: { root: {}, mover } });
    instance.subscribe((e) => events.push(e));
    return events;
  }

  it("fires with to: null and atEdge at the end of a list", () => {
    const events = mountList({ axis: "vertical" });
    press(byId("c"), "ArrowDown");

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.atEdge).toBe(true);
    expect(ev.to).toBeNull();
    expect(ev.from).toBe(byId("c"));
    expect(ev.fromIndex).toBe(2);
    expect(ev.direction).toBe("down");
    expect(ev.root).toBe(byId("root"));
  });

  it("fires at the start too, walking backwards", () => {
    const events = mountList({ axis: "vertical" });
    press(byId("a"), "ArrowUp");
    expect(events[0]?.atEdge).toBe(true);
    expect(events[0]?.direction).toBe("up");
  });

  it("a normal move carries no atEdge", () => {
    const events = mountList({ axis: "vertical" });
    press(byId("a"), "ArrowDown");
    expect(events[0]?.to).toBe(byId("b"));
    expect(events[0]?.atEdge).toBeUndefined();
  });

  it("a cyclic mover wraps instead, so it never reports an edge", () => {
    const events = mountList({ axis: "vertical", cyclic: true });
    press(byId("c"), "ArrowDown");
    expect(events[0]?.to).toBe(byId("a"));
    expect(events.every((e) => !e.atEdge)).toBe(true);
  });

  it("the cross axis is not an edge — it is a key that does not apply", () => {
    const events = mountList({ axis: "vertical" });
    press(byId("a"), "ArrowRight");
    expect(events).toHaveLength(0);
  });

  it("by default the key stays unclaimed, so the browser still gets it", () => {
    mountList({ axis: "vertical" });
    const ev = press(byId("c"), "ArrowDown");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("preventDefault() on the edge event claims the key", () => {
    const events = mountList({ axis: "vertical" });
    instance.subscribe((e) => {
      if (e.atEdge) e.preventDefault();
    });
    const ev = press(byId("c"), "ArrowDown");
    expect(events.at(-1)?.atEdge).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("edge events: grids", () => {
  function mountGrid(): TabspotNavigationEvent[] {
    const events: TabspotNavigationEvent[] = [];
    document.body.innerHTML = `
      <table id="root">
        <tr><td id="r0c0" tabindex="0">00</td><td id="r0c1" tabindex="-1">01</td></tr>
        <tr><td id="r1c0" tabindex="-1">10</td><td id="r1c1" tabindex="-1">11</td></tr>
      </table>`;
    instance = tabspot();
    setTabspotAttributes({
      element: byId("root"),
      config: {
        root: {},
        mover: { layout: "grid", items: "td", rows: { by: "selector", row: "tr" } },
      },
    });
    instance.subscribe((e) => events.push(e));
    return events;
  }

  it("reports the bottom edge with the origin cell", () => {
    const events = mountGrid();
    press(byId("r1c1"), "ArrowDown");
    expect(events[0]?.atEdge).toBe(true);
    expect(events[0]?.grid?.from).toEqual({ row: 1, col: 1 });
    expect(events[0]?.grid?.to).toBeNull();
  });

  it("reports the right edge of a row", () => {
    const events = mountGrid();
    press(byId("r0c1"), "ArrowRight");
    expect(events[0]?.atEdge).toBe(true);
    expect(events[0]?.direction).toBe("right");
  });
});
