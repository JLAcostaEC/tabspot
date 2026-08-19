import { describe, expect, it } from "vitest";
import { parseTabspotAttribute, serializeTabspotConfig, validateNodeOptions } from "../parser.ts";

describe("parser", () => {
  it("parses a valid root + mover config", () => {
    const cfg = parseTabspotAttribute(
      '{"root":{"manageSpecialKeys":{"Escape":true}},"mover":{"axis":"vertical","cyclic":true}}',
    );
    expect(cfg).toEqual({
      root: { manageSpecialKeys: { Escape: true } },
      mover: { axis: "vertical", cyclic: true },
    });
  });

  it("accepts the manageSpecialKeys boolean shorthand", () => {
    expect(parseTabspotAttribute('{"root":{"manageSpecialKeys":true}}')).toEqual({
      root: { manageSpecialKeys: true },
    });
  });

  it("accepts per-key manageSpecialKeys toggles", () => {
    expect(
      parseTabspotAttribute(
        '{"root":{"manageSpecialKeys":{"Home":true,"End":false,"PageDown":true}}}',
      ),
    ).toEqual({
      root: { manageSpecialKeys: { Home: true, End: false, PageDown: true } },
    });
  });

  it("rejects unknown keys inside manageSpecialKeys", () => {
    expect(parseTabspotAttribute('{"root":{"manageSpecialKeys":{"Enter":true}}}')).toBeNull();
    expect(parseTabspotAttribute('{"root":{"manageSpecialKeys":{"ArrowUp":true}}}')).toBeNull();
  });

  it("rejects non-boolean manageSpecialKeys values", () => {
    expect(parseTabspotAttribute('{"root":{"manageSpecialKeys":"true"}}')).toBeNull();
    expect(parseTabspotAttribute('{"root":{"manageSpecialKeys":{"Home":"yes"}}}')).toBeNull();
  });

  it("rejects the removed manageEscape/manageHomeEnd options", () => {
    expect(parseTabspotAttribute('{"root":{"manageEscape":true}}')).toBeNull();
    expect(parseTabspotAttribute('{"root":{"manageHomeEnd":true}}')).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseTabspotAttribute("not json")).toBeNull();
  });

  it("returns null on unknown section", () => {
    expect(parseTabspotAttribute('{"bogus":{}}')).toBeNull();
  });

  it("rejects root+grouper combination", () => {
    expect(parseTabspotAttribute('{"root":{},"grouper":{}}')).toBeNull();
  });

  it("rejects axis values outside horizontal/vertical", () => {
    expect(parseTabspotAttribute('{"mover":{"axis":"both"}}')).toBeNull();
    expect(parseTabspotAttribute('{"mover":{"axis":"diagonal"}}')).toBeNull();
  });

  it("rejects non-boolean booleans", () => {
    expect(parseTabspotAttribute('{"mover":{"cyclic":"true"}}')).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTabspotAttribute("")).toBeNull();
    expect(parseTabspotAttribute(null)).toBeNull();
  });

  it("validateNodeOptions throws on bad config", () => {
    expect(() => validateNodeOptions({ grouper: { axis: "horizontal" } })).toThrow();
  });

  it("serializeTabspotConfig round-trips valid config", () => {
    const json = serializeTabspotConfig({
      root: { manageSpecialKeys: { Escape: true } },
      mover: { axis: "horizontal", cyclic: true },
    });
    expect(parseTabspotAttribute(json)).toEqual({
      root: { manageSpecialKeys: { Escape: true } },
      mover: { axis: "horizontal", cyclic: true },
    });
  });

  it("accepts ignoreKeys with managed key names", () => {
    expect(
      parseTabspotAttribute('{"mover":{"axis":"vertical","ignoreKeys":["Tab","Home"]}}'),
    ).toEqual({
      mover: { axis: "vertical", ignoreKeys: ["Tab", "Home"] },
    });
  });

  it("rejects ignoreKeys with non-managed key names", () => {
    expect(parseTabspotAttribute('{"mover":{"ignoreKeys":["Enter"]}}')).toBeNull();
    expect(parseTabspotAttribute('{"mover":{"ignoreKeys":["a"]}}')).toBeNull();
  });

  it("rejects removed mover options (trackState, enterExitOnLast)", () => {
    expect(parseTabspotAttribute('{"mover":{"trackState":true}}')).toBeNull();
    expect(parseTabspotAttribute('{"mover":{"enterExitOnLast":true}}')).toBeNull();
  });

  it("rejects PartiallyVisible (no longer supported)", () => {
    expect(parseTabspotAttribute('{"mover":{"visibilityAware":"PartiallyVisible"}}')).toBeNull();
  });
});
