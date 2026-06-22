import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountContext, press, type ContextRefs } from "./fixtures/context.ts";

let ctx: ContextRefs;

beforeEach(() => {
  ctx = mountContext();
});
afterEach(() => ctx.teardown());

describe("navigation: header (vertical, cyclic, grouper)", () => {
  it("ArrowDown from header-first lands on Link #1", () => {
    press(ctx.byId("header-first"), "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Link #1");
  });

  it("ArrowUp from header-first cycles to Link #9", () => {
    press(ctx.byId("header-first"), "ArrowUp");
    expect(document.activeElement).toBe(ctx.byId("header-last"));
  });

  it("ArrowDown skips non-focusable Link #2 and lands on Link #3", () => {
    press(ctx.byText("Link #1"), "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Link #3");
  });

  it("ArrowRight from Link #3 enters grouper at Link #4", () => {
    press(ctx.byId("link3"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("Link #4");
  });

  it("inside grouper: cyclic horizontal", () => {
    press(ctx.byText("Link #4"), "ArrowLeft");
    expect(document.activeElement?.textContent?.trim()).toBe("Link #6");
    press(ctx.byText("Link #6"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("Link #4");
  });

  it("ArrowUp exits grouper from Link #4 to Link #3", () => {
    press(ctx.byText("Link #4"), "ArrowUp");
    expect(document.activeElement).toBe(ctx.byId("link3"));
  });

  it("Escape exits grouper to Link #3", () => {
    press(ctx.byText("Link #4"), "Escape");
    expect(document.activeElement).toBe(ctx.byId("link3"));
  });

  it("Link #5 owns sub-mover with buttons", () => {
    const link5Li = document.querySelectorAll<HTMLLIElement>(
      "#header-groupped-navigation > li[tabindex]",
    )[1]!;
    press(link5Li, "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Button");
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Button2");
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Button3");
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Button3");
  });

  it("Link #9 cycles down to header-first", () => {
    press(ctx.byId("header-last"), "ArrowDown");
    expect(document.activeElement).toBe(ctx.byId("header-first"));
  });

  it("Home jumps to first, End jumps to last", () => {
    press(ctx.byText("Link #7"), "Home");
    expect(document.activeElement).toBe(ctx.byId("header-first"));
    press(ctx.byText("Link #1"), "End");
    expect(document.activeElement).toBe(ctx.byId("header-last"));
  });
});

describe("navigation: main (horizontal, no cyclic)", () => {
  it("ArrowRight moves forward", () => {
    press(ctx.byText("Link #10"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("Link #11");
  });
  it("ArrowLeft at Link #10 does nothing", () => {
    const before = ctx.byText("Link #10");
    press(before, "ArrowLeft");
    expect(document.activeElement).toBe(before);
  });
  it("ArrowRight at Link #12 does nothing", () => {
    const before = ctx.byText("Link #12");
    press(before, "ArrowRight");
    expect(document.activeElement).toBe(before);
  });
});

describe("navigation: footer", () => {
  it("Link 13 cycles up to Link 15 via column inheritance", () => {
    press(ctx.byText("Link 13"), "ArrowUp");
    expect(document.activeElement?.textContent?.trim()).toBe("Link 15");
  });

  it("Link 15 ArrowDown cycles to Link 13", () => {
    press(ctx.byText("Link 15"), "ArrowDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Link 13");
  });

  it("Link 15 ArrowRight enters SubLink 15-1 (enterDirection)", () => {
    press(ctx.byText("Link 15"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 15-1");
  });

  it("SubLink 15-1 ArrowUp exits to Link 15", () => {
    press(ctx.byText("SubLink 15-1"), "ArrowUp");
    expect(document.activeElement?.textContent?.trim()).toBe("Link 15");
  });

  it("16-1..3 (vertical mover, exit up in-axis, no onLast): only 16-1 exits up", () => {
    press(ctx.byText("SubLink 16-1"), "ArrowUp");
    expect(document.activeElement?.textContent?.trim()).toBe("Link 18");
    press(ctx.byText("SubLink 16-2"), "ArrowUp");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 16-1");
    press(ctx.byText("SubLink 16-3"), "ArrowUp");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 16-2");
  });

  it("21-1..3 (horizontal mover, exit right in-axis, enterExitOnLast): ArrowLeft from Link 21 enters at 21-3", () => {
    press(ctx.byText("Link 21"), "ArrowLeft");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 21-3");
  });

  it("21-3 ArrowRight exits to Link 21; 21-1/21-2 ArrowRight stays in-group", () => {
    press(ctx.byText("SubLink 21-3"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("Link 21");

    press(ctx.byText("SubLink 21-1"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 21-2");
    press(ctx.byText("SubLink 21-2"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 21-3");
  });

  it("Link 22 ArrowRight enters its own subgroup at SubLink 22-1", () => {
    press(ctx.byText("Link 22"), "ArrowRight");
    expect(document.activeElement?.textContent?.trim()).toBe("SubLink 22-1");
  });

  it("Link 23 ArrowRight does NOT enter the previous sibling's subgroup", () => {
    const before = ctx.byText("Link 23");
    press(before, "ArrowRight");
    expect(document.activeElement).toBe(before);
  });
});
