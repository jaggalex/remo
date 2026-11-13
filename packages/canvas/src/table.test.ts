import { describe, expect, it } from "vitest";
import { headerText, type TableLayout, type Widget } from "@remo/model";
import {
  TABLE_HEADER_HEIGHT,
  TABLE_HEADER_MAX_HEIGHT,
  TABLE_HEADER_MAX_WIDTH,
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
    // The cell covers the object's offset from its own origin as well as its box
    // (ADR-202): the object keeps its place inside the cell.
    const first = cellRect(grid, "r1", "c1")!;
    expect(first.x).toBe(-300 + TABLE_HEADER_WIDTH);
    expect(first.width).toBe(138);
    expect(first.y).toBe(-200 + TABLE_HEADER_HEIGHT);
    expect(first.height).toBe(136);
  });

  it("keeps an empty axis at the minimum size", () => {
    const grid = layoutTable(frame(), [])!;
    expect(grid.columns[0]!.width).toBe(TABLE_MIN_COLUMN);
    expect(grid.rows[0]!.height).toBe(TABLE_MIN_ROW);
  });

  it("grows the header for a vertical or long row name", () => {
    const table = {
      ...frame(),
      layout: {
        kind: "table" as const,
        columns: [
          {
            id: "c1",
            title: "Очень длинный вертикальный заголовок колонки",
            vertical: true,
          },
        ],
        rows: [{ id: "r1", title: "Очень длинное название строки, которое не помещается" }],
      },
    };
    const grid = layoutTable(table, [])!;
    expect(grid.headerHeight).toBeGreaterThan(TABLE_HEADER_HEIGHT);
    expect(grid.headerHeight).toBeLessThanOrEqual(TABLE_HEADER_MAX_HEIGHT);
    expect(grid.headerWidth).toBeGreaterThan(TABLE_HEADER_WIDTH);
    expect(grid.headerWidth).toBeLessThanOrEqual(TABLE_HEADER_MAX_WIDTH);
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

describe("merged blocks (ADR-204)", () => {
  const merged: TableLayout = {
    ...layout,
    spans: [{ rowId: "r1", columnId: "c1", rowSpan: 2, columnSpan: 1 }],
  };

  it("draws one anchor cell and finds it through a covered axis", () => {
    const grid = layoutTable({ ...frame(), layout: merged }, [])!;
    const anchors = grid.cells.filter((cell) => cell.columnId === "c1");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ rowId: "r1", rowSpan: 2, columnSpan: 1 });
    const covered = cellRect(grid, "r2", "c1")!;
    expect(covered).toEqual(cellRect(grid, "r1", "c1"));
    expect(covered.height).toBe(
      grid.rows[0]!.height + grid.rows[1]!.height,
    );
    const point = { x: covered.x + 10, y: covered.y + covered.height - 10 };
    expect(tableHitAt(grid, point)).toMatchObject({
      kind: "cell",
      rowId: "r1",
      columnId: "c1",
    });
    expect(acceptsObjects(tableHitAt(grid, point))).toBe(true);
  });

  it("grows the last covered column so the merged cell holds its content", () => {
    const block: TableLayout = {
      kind: "table",
      columns: [
        { id: "c1", title: "A" },
        { id: "c2", title: "B" },
      ],
      rows: [{ id: "r1", title: "1" }],
      spans: [{ rowId: "r1", columnId: "c1", rowSpan: 1, columnSpan: 2 }],
    };
    const table = { ...frame(), layout: block };
    const grid = layoutTable(table, [])!;
    const start = grid.columns[0]!.x;
    const note: Widget = {
      id: "wide",
      type: "sticky_note",
      parentId: "f",
      x: start + 200,
      y: grid.origin.y + grid.headerHeight + 50,
      width: 400,
      height: 80,
      cell: { rowId: "r1", columnId: "c1" },
    };
    const grown = layoutTable(table, [note])!;
    expect(grown.cells[0]!.rect.width).toBeGreaterThanOrEqual(400 + 16 * 2);
    // The first column keeps its own size; only the last covered axis takes the deficit.
    expect(grown.columns[0]!.width).toBe(grid.columns[0]!.width);
  });
});

describe("header text, explicit lines and manual header size (ADR-217)", () => {
  it("keeps an intentional line break and grows the band", () => {
    const table = {
      ...frame(),
      layout: {
        kind: "table" as const,
        columns: [{ id: "c1", title: "Первая\nстрока" }],
        rows: [{ id: "r1", title: "1" }],
      },
    };
    const grid = layoutTable(table, [])!;
    expect(headerText("Первая\nстрока")).toBe("Первая\nстрока");
    expect(grid.headerHeight).toBeGreaterThan(TABLE_HEADER_HEIGHT);
  });

  it("uses a manual header width and height over Auto", () => {
    const table = {
      ...frame(),
      layout: {
        kind: "table" as const,
        headerWidth: 200,
        headerHeight: 120,
        columns: [{ id: "c1", title: "A" }],
        rows: [{ id: "r1", title: "1" }],
      },
    };
    const grid = layoutTable(table, [])!;
    expect(grid.headerWidth).toBe(200);
    expect(grid.headerHeight).toBe(120);
  });

  it("draws a vertical row header inside the strip, not the label width", () => {
    const table = {
      ...frame(),
      layout: {
        kind: "table" as const,
        columns: [{ id: "c1", title: "A" }],
        rows: [{ id: "r1", title: "Очень длинная строка", vertical: true }],
      },
    };
    const grid = layoutTable(table, [])!;
    expect(grid.headerWidth).toBe(TABLE_HEADER_WIDTH);
  });
});
