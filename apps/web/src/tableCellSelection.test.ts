import { describe, expect, it } from "vitest";
import type { TableLayout } from "@remo/model";
import { tableCellRangeIds } from "./tableCellSelection";

const layout: TableLayout = {
  kind: "table",
  columns: [
    { id: "c1", title: "A" },
    { id: "c2", title: "B" },
    { id: "c3", title: "C" },
  ],
  rows: [
    { id: "r1", title: "1" },
    { id: "r2", title: "2" },
  ],
};

describe("table cell range (ADR-204)", () => {
  it("lists every cell of the rectangle in row-major order", () => {
    expect(
      tableCellRangeIds(layout, { rowId: "r1", columnId: "c1" }, { rowId: "r2", columnId: "c2" }),
    ).toEqual([
      { rowId: "r1", columnId: "c1" },
      { rowId: "r1", columnId: "c2" },
      { rowId: "r2", columnId: "c1" },
      { rowId: "r2", columnId: "c2" },
    ]);
  });

  it("works in any drag direction and returns nothing for an unknown axis", () => {
    expect(
      tableCellRangeIds(layout, { rowId: "r2", columnId: "c2" }, { rowId: "r2", columnId: "c2" }),
    ).toEqual([{ rowId: "r2", columnId: "c2" }]);
    expect(
      tableCellRangeIds(layout, { rowId: "missing", columnId: "c1" }, { rowId: "r2", columnId: "c2" }),
    ).toEqual([]);
  });
});
