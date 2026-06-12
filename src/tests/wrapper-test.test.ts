import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
let instance: ReturnType<typeof tabspot>;
beforeEach(() => {
  document.body.innerHTML = "";
  instance = tabspot();
});
afterEach(() => instance.destroy());

describe("wrapper traversal", () => {
  it("focusables nested inside multiple non-configured wrappers are reachable", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div><div><button id="a">A</button></div></div>
      <section><span><button id="b">B</button></span></section>
    `;
    document.body.appendChild(root);
    setTabspotAttributes({ element: root, config: { root: {}, mover: { axis: "vertical" } } });
    const a = root.querySelector("#a") as HTMLElement;
    const b = root.querySelector("#b") as HTMLElement;
    a.focus();
    a.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    console.log("after arrowdown, active=", (document.activeElement as HTMLElement)?.id);
    expect(document.activeElement).toBe(b);
  });
});
