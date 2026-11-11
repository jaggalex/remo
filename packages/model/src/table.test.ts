import { describe, expect, it } from "vitest";
import { readWidget } from "./sanitize";
import { tableCellFill, type TableLayout } from "./table";
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
    expect(headerText("  A \n  B ")).toBe("A B");
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
