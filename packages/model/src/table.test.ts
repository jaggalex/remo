import { describe, expect, it } from "vitest";
import { readWidget } from "./sanitize";
import {
  isCoveredCell,
  tableCellBorder,
  tableCellFill,
  tableCellPadding,
  tableSpanAt,
  tableSpanAxes,
  type TableLayout,
} from "./table";
import { headerText, TABLE_HEADER_MAX_TEXT } from "./tableGeometry";

const layout: TableLayout = {
  kind: "table",
  columns: [
    { id: "c1", title: "Now" },
    { id: "c2", title: "Next", vertical: true },
  ],
  rows: [
    { id: "r1", title: "Step 1" },
    { id: "r2", title: "Step 2", size: "wide" },
  ],
  appearance: {
    table: "#ffffff",
    headers: "#eeeeee",
    columns: { c1: "#ff0000" },
    rows: { r2: "#00ff00" },
    cells: { "r1:c2": "#0000ff" },
  },
};

describe("table header text (ADR-201)", () => {
  it("collapses whitespace and shortens a title past the cap", () => {
    expect(headerText("  A \n  B ")).toBe("A\nB");
    const long = "x".repeat(TABLE_HEADER_MAX_TEXT + 20);
    const cut = headerText(long);
    expect(cut).toHaveLength(TABLE_HEADER_MAX_TEXT);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("table fills (ADR-199)", () => {
  it("uses the most specific override: cell, row, column, headers, table", () => {
    expect(tableCellFill(layout, "r1", "c2")).toBe("#0000ff");
    expect(tableCellFill(layout, "r2", "c2")).toBe("#00ff00");
    expect(tableCellFill(layout, "r1", "c1")).toBe("#ff0000");
    expect(tableCellFill(layout, "r2", "c1")).toBe("#00ff00");
    expect(tableCellFill({ ...layout, appearance: { table: "#fff" } }, "r1", "c1")).toBe("#fff");
    expect(tableCellFill({ ...layout, appearance: undefined }, "r1", "c1")).toBeUndefined();
  });
});

describe("reading a table (ADR-171, ADR-199)", () => {
  it("keeps a valid layout and cell", () => {
    const widget = readWidget(
      {
        id: "f",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        layout,
      },
      "f",
    );
    expect(widget?.layout).toMatchObject({ kind: "table", columns: layout.columns });
    expect(widget?.layout?.appearance?.cells).toEqual({ "r1:c2": "#0000ff" });
  });

  it("keeps a valid cell on a child", () => {
    const widget = readWidget(
      {
        id: "n",
        type: "sticky_note",
        parentId: "f",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        cell: { rowId: "r1", columnId: "c2" },
      },
      "n",
    );
    expect(widget?.cell).toEqual({ rowId: "r1", columnId: "c2" });
  });

  it("drops a malformed layout and leaves the section free", () => {
    const widget = readWidget(
      {
        id: "f",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        layout: { kind: "table", columns: "no", rows: [] },
      },
      "f",
    );
    expect(widget?.layout).toBeUndefined();
  });

  it("drops an axis with a malformed id or size and deduplicates ids", () => {
    const widget = readWidget(
      {
        id: "f",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        layout: {
          kind: "table",
          columns: [
            { id: "c1", title: "A" },
            { id: "c1", title: "Duplicate" },
            { id: 2, title: "Bad" },
            { id: "c2", title: "B", size: "huge" },
          ],
          rows: [{ id: "r1", title: "R" }],
        },
      },
      "f",
    );
    expect(widget?.layout?.columns).toEqual([{ id: "c1", title: "A" }]);
  });

  it("drops a malformed cell", () => {
    const widget = readWidget(
      {
        id: "n",
        type: "sticky_note",
        parentId: "f",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        cell: { rowId: "r1" },
      },
      "n",
    );
    expect(widget?.cell).toBeUndefined();
  });
});

describe("merged spans (ADR-204)", () => {
  const base = {
    columns: [
      { id: "c1", title: "A" },
      { id: "c2", title: "B" },
    ],
    rows: [
      { id: "r1", title: "1" },
      { id: "r2", title: "2" },
    ],
  };

  it("keeps a valid span and drops overlaps, singletons and out-of-range blocks", () => {
    const widget = readWidget(
      {
        id: "f",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        layout: {
          kind: "table",
          ...base,
          spans: [
            { rowId: "r2", columnId: "c2", rowSpan: 1, columnSpan: 1 },
            { rowId: "r1", columnId: "c1", rowSpan: 1, columnSpan: 2 },
            { rowId: "r2", columnId: "c1", rowSpan: 1, columnSpan: 2 },
            { rowId: "r1", columnId: "c2", rowSpan: 2, columnSpan: 2 },
            { rowId: "missing", columnId: "c1", rowSpan: 2, columnSpan: 1 },
            { rowId: "r1", columnId: "c1", rowSpan: 2, columnSpan: 1 },
          ],
        },
      },
      "f",
    );
    expect(widget?.layout?.spans).toEqual([
      { rowId: "r1", columnId: "c1", rowSpan: 1, columnSpan: 2 },
      { rowId: "r2", columnId: "c1", rowSpan: 1, columnSpan: 2 },
    ]);
  });

  it("finds the span that covers a cell, anchor or not", () => {
    const layout: TableLayout = {
      kind: "table",
      ...base,
      spans: [{ rowId: "r1", columnId: "c1", rowSpan: 2, columnSpan: 2 }],
    };
    expect(tableSpanAt(layout, "r2", "c2")).toMatchObject({ rowSpan: 2, columnSpan: 2 });
    expect(isCoveredCell(layout, "r2", "c2")).toBe(true);
    expect(isCoveredCell(layout, "r1", "c1")).toBe(false);
    expect(tableSpanAt(layout, "r1", "missing")).toBeNull();
    expect(tableSpanAxes(layout, layout.spans![0]!)).toEqual({
      rows: ["r1", "r2"],
      columns: ["c1", "c2"],
    });
  });
});

describe("borders and paddings (ADR-208)", () => {
  const styled: TableLayout = {
    ...layout,
    appearance: {
      borders: {
        table: { color: "#111111", width: 1, style: "solid" },
        headers: { color: "#222222", width: 2, style: "dashed" },
        columns: { c2: { color: "#333333", width: 1, style: "solid" } },
        cells: { "r1:c2": { color: "#444444", width: 3, style: "none" } },
      },
      paddings: {
        table: 8,
        headers: 12,
        columns: { c2: 20 },
        cells: { "r1:c2": 32 },
      },
    },
  };

  it("uses the most specific border and padding, cell first", () => {
    expect(tableCellBorder(styled, "r1", "c2")).toMatchObject({ color: "#444444", width: 3 });
    expect(tableCellBorder(styled, "r2", "c2")).toMatchObject({ color: "#333333", width: 1 });
    expect(tableCellBorder(styled, "r1", "c1")).toMatchObject({ color: "#222222", width: 2 });
    expect(tableCellPadding(styled, "r1", "c2")).toBe(32);
    expect(tableCellPadding(styled, "r2", "c2")).toBe(20);
    expect(tableCellPadding(styled, "r1", "c1")).toBe(12);
    expect(tableCellPadding({ ...styled, appearance: {} }, "r1", "c1")).toBeUndefined();
  });

  it("reads valid borders and paddings and drops malformed ones", () => {
    const widget = readWidget(
      {
        id: "f",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        layout: {
          kind: "table",
          ...layout,
          appearance: {
            borders: {
              table: { color: "#000000", width: 1, style: "solid" },
              cells: {
                "r1:c1": { color: "#ffffff", width: 2, style: "dashed" },
                "r1:c2": { color: "#ffffff", width: 99, style: "solid" },
              },
            },
            paddings: { table: 8, rows: { r1: 40, r2: 200 } },
          },
        },
      },
      "f",
    );
    expect(widget?.layout?.appearance?.borders?.table).toMatchObject({ width: 1 });
    expect(widget?.layout?.appearance?.borders?.cells).toEqual({
      "r1:c1": { color: "#ffffff", width: 2, style: "dashed" },
    });
    expect(widget?.layout?.appearance?.paddings).toEqual({ table: 8, rows: { r1: 40 } });
  });
});
