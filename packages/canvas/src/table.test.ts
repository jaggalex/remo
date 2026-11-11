import { describe, expect, it } from "vitest";
import type { TableLayout, Widget } from "@remo/model";
import {
  TABLE_HEADER_HEIGHT,
  TABLE_HEADER_WIDTH,
  TABLE_MIN_COLUMN,
  TABLE_MIN_ROW,
  acceptsObjects,
  cellFill,
  cellRect,
  layoutTable,
  tableCellPlacement,
  tableHitAt,
} from "./table";

const layout: TableLayout = {
  kind: "table",
  columns: [
    { id: "c1", title: "Now" },
    { id: "c2", title: "Next", size: "wide" },
  ],
  rows: [
    { id: "r1", title: "Step 1" },
    { id: "r2", title: "Step 2" },
  ],
  appearance: { cells: { "r1:c2": "#ff0000" } },
};

function frame(): Widget {
  return {
    id: "f",
    type: "frame",
    parentId: null,
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
    layout,
  };
}

function note(id: string, rowId: string, columnId: string, x: number, y: number): Widget {
  return {
    id,
    type: "sticky_note",
    parentId: "f",
    x,
    y,
    width: 100,
    height: 80,
    cell: { rowId, columnId },
  };
}

describe("table geometry (ADR-196, ADR-199)", () => {
  it("lays out headers, cells and the row/column order", () => {
    const grid = layoutTable(frame(), [note("a", "r1", "c1", -100, -80)])!;
    expect(grid.origin).toEqual({ x: -300, y: -200 });
    expect(grid.headerWidth).toBe(TABLE_HEADER_WIDTH);
    expect(grid.headerHeight).toBe(TABLE_HEADER_HEIGHT);
    expect(grid.columns[0]!.width).toBeGreaterThanOrEqual(TABLE_MIN_COLUMN);
    expect(grid.columns[1]!.width).toBe(340);
    expect(grid.rows[0]!.height).toBeGreaterThanOrEqual(TABLE_MIN_ROW);
    expect(grid.cells).toHaveLength(4);
    expect(cellRect(grid, "r1", "c2")).toMatchObject({ width: 340 });
    expect(cellRect(grid, "missing", "c1")).toBeNull();
    // The cell is sized by the object's own box plus padding, not by where it lies
    // (ADR-201): the reflow puts it at the padding corner.
    const first = cellRect(grid, "r1", "c1")!;
    expect(first.x).toBe(-300 + TABLE_HEADER_WIDTH);
    expect(first.width).toBe(100 + 32);
    expect(first.y).toBe(-200 + TABLE_HEADER_HEIGHT);
    expect(first.height).toBe(80 + 32);
  });

  it("keeps an empty axis at the minimum size", () => {
    const grid = layoutTable(frame(), [])!;
    expect(grid.columns[0]!.width).toBe(TABLE_MIN_COLUMN);
    expect(grid.rows[0]!.height).toBe(TABLE_MIN_ROW);
  });

  it("places a selection at the target cell's padding corner", () => {
    const notes = [note("a", "r1", "c1", -100, -80), note("b", "r1", "c1", -20, -20)];
    const grid = layoutTable(frame(), notes)!;
    const cell = cellRect(grid, "r1", "c2")!;
    const offset = tableCellPlacement(grid, "r1", "c2", notes, ["a", "b"])!;
    // The union box starts at a box's left/top, not its centre: 50 and 40 from the centre.
    expect(offset.x).toBe(cell.x + 16 + 150);
    expect(offset.y).toBe(cell.y + 16 + 120);
    expect(tableCellPlacement(grid, "r1", "missing", notes, ["a"])).toBeNull();
    expect(tableCellPlacement(grid, "r1", "c2", notes, ["missing"])).toBeNull();
  });

  it("distinguishes a data cell from a header, and only a cell accepts objects", () => {
    const grid = layoutTable(frame(), [])!;
    const cell = grid.cells[0]!.rect;
    const point = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
    const hit = tableHitAt(grid, point);
    expect(hit).toMatchObject({ kind: "cell", rowId: "r1", columnId: "c1" });
    expect(acceptsObjects(hit)).toBe(true);

    const headerPoint = {
      x: grid.columns[0]!.x + 10,
      y: grid.origin.y + grid.headerHeight / 2,
    };
    const header = tableHitAt(grid, headerPoint);
    expect(header).toMatchObject({ kind: "column-header", axisId: "c1" });
    expect(acceptsObjects(header)).toBe(false);
  });

  it("returns no grid for a free or inactive section", () => {
    expect(layoutTable({ ...frame(), layout: undefined }, [])).toBeNull();
    expect(
      layoutTable({ ...frame(), layout: { ...layout, active: false } }, []),
    ).toBeNull();
  });

  it("reads the most specific cell fill", () => {
    expect(cellFill(frame(), "r1", "c2")).toBe("#ff0000");
    expect(cellFill(frame(), "r2", "c2")).toBeUndefined();
  });
});
