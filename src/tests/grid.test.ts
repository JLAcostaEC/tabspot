import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabspotAttributes, tabspot } from "../index.ts";
import type { GridFlow, TabspotInstance } from "../index.ts";
import { press } from "./fixtures/context.ts";

/**
 * Two 3x3 tables matching `new mover directions.html`:
 *
 *   Header 1  Header 2  Header 3
 *   Data 1    Data 2    Data 3
 *   Data 4    Data 5    Data 6
 *
 * flow "contained" == the old "grid"; flow "linear" == the old "gridLinear".
 */
function table(id: string): string {
  return `
    <table id="${id}">
      <thead>
        <tr>
          <th tabindex="0">Header 1</th>
          <th tabindex="0">Header 2</th>
          <th tabindex="0">Header 3</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td tabindex="0">Data 1</td>
          <td tabindex="0">Data 2</td>
          <td tabindex="0">Data 3</td>
        </tr>
        <tr>
          <td tabindex="0">Data 4</td>
          <td tabindex="0">Data 5</td>
          <td tabindex="0">Data 6</td>
        </tr>
      </tbody>
    </table>`;
}

interface GridRefs {
  instance: TabspotInstance;
  cell: (text: string) => HTMLElement;
  teardown(): void;
}

function mountGrid(flow: GridFlow, cyclic = false): GridRefs {
  document.body.innerHTML = table("grid");
  const instance = tabspot();
  const root = document.getElementById("grid") as HTMLElement;
  setTabspotAttributes({
    element: root,
    config: { root: { manageHomeEnd: true }, mover: { layout: "grid", flow, cyclic } },
  });

  return {
    instance,
    cell: (text) => {
      for (const c of document.querySelectorAll<HTMLElement>("th, td")) {
        if ((c.textContent ?? "").trim() === text) return c;
      }
      throw new Error(`No cell with text "${text}"`);
    },
    teardown() {
      instance.destroy();
      document.body.innerHTML = "";
    },
  };
}

/** Press `key` on the cell with `from` text and assert focus lands on `expected`. */
function expectMove(ctx: GridRefs, from: string, key: string, expected: string | null): void {
  const start = ctx.cell(from);
  press(start, key);
  if (expected === null) {
    // No move: focus must stay on the originating cell.
    expect(document.activeElement).toBe(start);
  } else {
    expect(document.activeElement?.textContent?.trim()).toBe(expected);
  }
}

describe("grid mover (2-D matrix, clamped)", () => {
  let ctx: GridRefs;
  beforeEach(() => (ctx = mountGrid("contained")));
  afterEach(() => ctx.teardown());

  it("Header 1: Right->Header 2, Left->none, Down->Data 1, Up->none", () => {
    expectMove(ctx, "Header 1", "ArrowRight", "Header 2");
    expectMove(ctx, "Header 1", "ArrowLeft", null);
    expectMove(ctx, "Header 1", "ArrowDown", "Data 1");
    expectMove(ctx, "Header 1", "ArrowUp", null);
  });

  it("Header 2: Right->Header 3, Left->Header 1, Down->Data 2, Up->none", () => {
    expectMove(ctx, "Header 2", "ArrowRight", "Header 3");
    expectMove(ctx, "Header 2", "ArrowLeft", "Header 1");
    expectMove(ctx, "Header 2", "ArrowDown", "Data 2");
    expectMove(ctx, "Header 2", "ArrowUp", null);
  });

  it("Header 3: Right->none, Left->Header 2, Down->Data 3, Up->none", () => {
    expectMove(ctx, "Header 3", "ArrowRight", null);
    expectMove(ctx, "Header 3", "ArrowLeft", "Header 2");
    expectMove(ctx, "Header 3", "ArrowDown", "Data 3");
    expectMove(ctx, "Header 3", "ArrowUp", null);
  });

  it("Data 1: Right->Data 2, Left->none, Down->Data 4, Up->Header 1", () => {
    expectMove(ctx, "Data 1", "ArrowRight", "Data 2");
    expectMove(ctx, "Data 1", "ArrowLeft", null);
    expectMove(ctx, "Data 1", "ArrowDown", "Data 4");
    expectMove(ctx, "Data 1", "ArrowUp", "Header 1");
  });

  it("Data 2: Right->Data 3, Left->Data 1, Down->Data 5, Up->Header 2", () => {
    expectMove(ctx, "Data 2", "ArrowRight", "Data 3");
    expectMove(ctx, "Data 2", "ArrowLeft", "Data 1");
    expectMove(ctx, "Data 2", "ArrowDown", "Data 5");
    expectMove(ctx, "Data 2", "ArrowUp", "Header 2");
  });

  it("Data 3: Right->none, Left->Data 2, Down->Data 6, Up->Header 3", () => {
    expectMove(ctx, "Data 3", "ArrowRight", null);
    expectMove(ctx, "Data 3", "ArrowLeft", "Data 2");
    expectMove(ctx, "Data 3", "ArrowDown", "Data 6");
    expectMove(ctx, "Data 3", "ArrowUp", "Header 3");
  });

  it("Data 4: Right->Data 5, Left->none, Down->none, Up->Data 1", () => {
    expectMove(ctx, "Data 4", "ArrowRight", "Data 5");
    expectMove(ctx, "Data 4", "ArrowLeft", null);
    expectMove(ctx, "Data 4", "ArrowDown", null);
    expectMove(ctx, "Data 4", "ArrowUp", "Data 1");
  });

  it("Data 5: Right->Data 6, Left->Data 4, Down->none, Up->Data 2", () => {
    expectMove(ctx, "Data 5", "ArrowRight", "Data 6");
    expectMove(ctx, "Data 5", "ArrowLeft", "Data 4");
    expectMove(ctx, "Data 5", "ArrowDown", null);
    expectMove(ctx, "Data 5", "ArrowUp", "Data 2");
  });

  it("Data 6: Right->none, Left->Data 5, Down->none, Up->Data 3", () => {
    expectMove(ctx, "Data 6", "ArrowRight", null);
    expectMove(ctx, "Data 6", "ArrowLeft", "Data 5");
    expectMove(ctx, "Data 6", "ArrowDown", null);
    expectMove(ctx, "Data 6", "ArrowUp", "Data 3");
  });
});

describe("gridLinear mover (linear horizontal, columnar vertical)", () => {
  let ctx: GridRefs;
  beforeEach(() => (ctx = mountGrid("linear")));
  afterEach(() => ctx.teardown());

  it("Header 3: Right->Data 1 (continues into next row), Left->Header 2", () => {
    expectMove(ctx, "Header 3", "ArrowRight", "Data 1");
    expectMove(ctx, "Header 3", "ArrowLeft", "Header 2");
    expectMove(ctx, "Header 3", "ArrowDown", "Data 3");
    expectMove(ctx, "Header 3", "ArrowUp", null);
  });

  it("Data 1: Left->Header 3 (continues into previous row), Right->Data 2", () => {
    expectMove(ctx, "Data 1", "ArrowRight", "Data 2");
    expectMove(ctx, "Data 1", "ArrowLeft", "Header 3");
    expectMove(ctx, "Data 1", "ArrowDown", "Data 4");
    expectMove(ctx, "Data 1", "ArrowUp", "Header 1");
  });

  it("Data 3: Right->Data 4, Left->Data 2", () => {
    expectMove(ctx, "Data 3", "ArrowRight", "Data 4");
    expectMove(ctx, "Data 3", "ArrowLeft", "Data 2");
    expectMove(ctx, "Data 3", "ArrowDown", "Data 6");
    expectMove(ctx, "Data 3", "ArrowUp", "Header 3");
  });

  it("Data 4: Left->Data 3, Right->Data 5", () => {
    expectMove(ctx, "Data 4", "ArrowRight", "Data 5");
    expectMove(ctx, "Data 4", "ArrowLeft", "Data 3");
    expectMove(ctx, "Data 4", "ArrowUp", "Data 1");
    expectMove(ctx, "Data 4", "ArrowDown", null);
  });

  it("Header 1: Left->none (global start), Right->Header 2", () => {
    expectMove(ctx, "Header 1", "ArrowLeft", null);
    expectMove(ctx, "Header 1", "ArrowRight", "Header 2");
    expectMove(ctx, "Header 1", "ArrowUp", null);
    expectMove(ctx, "Header 1", "ArrowDown", "Data 1");
  });

  it("Data 6: Right->none (global end), Left->Data 5, Down->none, Up->Data 3", () => {
    expectMove(ctx, "Data 6", "ArrowRight", null);
    expectMove(ctx, "Data 6", "ArrowLeft", "Data 5");
    expectMove(ctx, "Data 6", "ArrowDown", null);
    expectMove(ctx, "Data 6", "ArrowUp", "Data 3");
  });
});

describe("grid mover with cyclic: wraps within row and column", () => {
  let ctx: GridRefs;
  beforeEach(() => (ctx = mountGrid("contained", true)));
  afterEach(() => ctx.teardown());

  it("Header 3 Right wraps to Header 1; Header 1 Left wraps to Header 3", () => {
    expectMove(ctx, "Header 3", "ArrowRight", "Header 1");
    expectMove(ctx, "Header 1", "ArrowLeft", "Header 3");
  });

  it("Data 4 Down wraps to Header 1 (column 0); Header 1 Up wraps to Data 4", () => {
    expectMove(ctx, "Data 4", "ArrowDown", "Header 1");
    expectMove(ctx, "Header 1", "ArrowUp", "Data 4");
  });
});

describe("gridLinear mover with cyclic: horizontal wraps the whole sequence", () => {
  let ctx: GridRefs;
  beforeEach(() => (ctx = mountGrid("linear", true)));
  afterEach(() => ctx.teardown());

  it("Data 6 Right wraps to Header 1; Header 1 Left wraps to Data 6", () => {
    expectMove(ctx, "Data 6", "ArrowRight", "Header 1");
    expectMove(ctx, "Header 1", "ArrowLeft", "Data 6");
  });
});

describe("grid keys: Home/End by row, Ctrl+Home/End, Page", () => {
  let ctx: GridRefs;
  beforeEach(() => (ctx = mountGrid("contained")));
  afterEach(() => ctx.teardown());

  it("Home/End move to the start/end of the current row", () => {
    press(ctx.cell("Data 2"), "Home");
    expect(document.activeElement?.textContent?.trim()).toBe("Data 1");
    press(ctx.cell("Data 2"), "End");
    expect(document.activeElement?.textContent?.trim()).toBe("Data 3");
  });

  it("Ctrl+Home/Ctrl+End jump to the first/last cell of the grid", () => {
    press(ctx.cell("Data 5"), "Home", { ctrlKey: true });
    expect(document.activeElement?.textContent?.trim()).toBe("Header 1");
    press(ctx.cell("Data 5"), "End", { ctrlKey: true });
    expect(document.activeElement?.textContent?.trim()).toBe("Data 6");
  });

  it("PageDown/PageUp jump rows within the column (clamped on a small grid)", () => {
    press(ctx.cell("Header 1"), "PageDown");
    expect(document.activeElement?.textContent?.trim()).toBe("Data 4"); // col 0, clamped to last row
    press(ctx.cell("Data 4"), "PageUp");
    expect(document.activeElement?.textContent?.trim()).toBe("Header 1");
  });
});
