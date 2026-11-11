import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { BoardDocument, loadBoard } from "./board";
import {
  addAxis,
  deleteAxis,
  moveAxis,
  moveSelectionToCell,
  removeTable,
  renameAxis,
  setAxisSize,
  setAxisVertical,
  setTableFill,
  showTable,
  tableLayoutOf,
} from "./table";
import { deleteWidgets, moveWidgets, setWidgetRects } from "./widgets";
import { layoutTable, TABLE_CELL_PADDING } from "@remo/model";

function boardWith(widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  loadBoard(board, { id: "t", title: "Table", widgets }, {});
  return board;
}

function note(id: string, x: number, y = 0): Widget {
  return { id, type: "sticky_note", parentId: "f", x, y, width: 100, height: 100, content: id };
}

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
  };
}

function withNotes(): BoardDocument {
  return boardWith([frame(), note("a", -100), note("b", 100)]);
}

describe("table axes (ADR-196, ADR-199)", () => {
  it("the first column keeps old material in the first cell and adds an empty one", () => {
    const board = withNotes();
    const newColumn = addAxis(board, "f", "column", {
      title: "Next",
      firstTitle: "Now",
      oppositeTitle: "Row",
    })!;
    const layout = tableLayoutOf(board, "f")!;
    expect(layout.columns.map((axis) => axis.title)).toEqual(["Now", "Next"]);
    expect(layout.rows).toHaveLength(1);
    expect(newColumn).toBe(layout.columns[1]!.id);
    expect(board.widgets.get("a")!.cell).toEqual({
      rowId: layout.rows[0]!.id,
      columnId: layout.columns[0]!.id,
    });
    expect(board.widgets.get("b")!.cell).toEqual({
      rowId: layout.rows[0]!.id,
      columnId: layout.columns[0]!.id,
    });

    board.undoOnce();
    expect(tableLayoutOf(board, "f")).toBeNull();
    expect(board.widgets.get("a")!.cell).toBeUndefined();
  });

  it("a later row is empty and keeps existing cells", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const before = tableLayoutOf(board, "f")!;
    const row = addAxis(board, "f", "row", {
      title: "Step 2",
      firstTitle: "Step 1",
    })!;
    const after = tableLayoutOf(board, "f")!;
    expect(after.rows).toHaveLength(2);
    expect(after.rows[1]!.id).toBe(row);
    expect(board.widgets.get("a")!.cell).toEqual({
      rowId: before.rows[0]!.id,
      columnId: before.columns[0]!.id,
    });
  });

  it("renames and sizes an axis, and only a column can be vertical", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const column = layout.columns[1]!;
    const row = layout.rows[0]!;

    expect(renameAxis(board, "f", column.id, "  Later  ")).toBe(true);
    expect(setAxisSize(board, "f", column.id, "wide")).toBe(true);
    expect(setAxisVertical(board, "f", column.id, true)).toBe(true);
    expect(setAxisVertical(board, "f", row.id, true)).toBe(false);

    const next = tableLayoutOf(board, "f")!;
    expect(next.columns[1]).toMatchObject({ title: "Later", size: "wide", vertical: true });
    expect(setAxisSize(board, "f", column.id, "auto")).toBe(true);
    expect(tableLayoutOf(board, "f")!.columns[1]!.size).toBeUndefined();
  });

  it("moves an axis without touching cell ids", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const [first, second] = layout.columns;
    expect(moveAxis(board, "f", second!.id, -1)).toBe(true);
    const next = tableLayoutOf(board, "f")!;
    expect(next.columns.map((axis) => axis.id)).toEqual([second!.id, first!.id]);
    expect(board.widgets.get("a")!.cell!.columnId).toBe(first!.id);
  });

  it("deletes an axis by moving its objects to a neighbour", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const [first, second] = layout.columns;
    const result = deleteAxis(board, "f", first!.id, { mode: "move" });
    expect(result).toMatchObject({ ok: true, movedTo: second!.id });
    expect(tableLayoutOf(board, "f")!.columns.map((axis) => axis.id)).toEqual([second!.id]);
    expect(board.widgets.get("a")!.cell!.columnId).toBe(second!.id);
  });

  it("deletes an axis with its objects only on the explicit mode", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const first = layout.columns[0]!;
    expect(deleteAxis(board, "f", first.id, { mode: "move" })).toMatchObject({ ok: true });

    const board2 = withNotes();
    addAxis(board2, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const first2 = tableLayoutOf(board2, "f")!.columns[0]!;
    const result = deleteAxis(board2, "f", first2.id, { mode: "withObjects" });
    expect(result).toMatchObject({ ok: true, deleted: ["a", "b"] });
    expect(board2.widgets.get("a")).toBeUndefined();
    expect(tableLayoutOf(board2, "f")!.columns).toHaveLength(1);

    board2.undoOnce();
    expect(board2.widgets.get("a")).toBeDefined();
    expect(tableLayoutOf(board2, "f")!.columns).toHaveLength(2);
  });

  it("moves a selection into a cell", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const result = moveSelectionToCell(board, "f", ["a"], {
      rowId: layout.rows[0]!.id,
      columnId: layout.columns[1]!.id,
    });
    expect(result).toEqual({ moved: ["a"], blocked: [] });
    expect(board.widgets.get("a")!.cell).toEqual({
      rowId: layout.rows[0]!.id,
      columnId: layout.columns[1]!.id,
    });
  });

  it("lands a selection in a cell with one offset and keeps the arrangement", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const beforeA = board.widgets.get("a")!;
    const beforeB = board.widgets.get("b")!;
    const beforeCell = beforeA.cell;
    const result = moveSelectionToCell(board, "f", ["a", "b"], {
      rowId: layout.rows[0]!.id,
      columnId: layout.columns[1]!.id,
      offset: { x: 300, y: 120 },
    });
    expect(result).toEqual({ moved: ["a", "b"], blocked: [] });
    expect(board.widgets.get("a")).toMatchObject({ parentId: "f" });
    expect(board.widgets.get("b")).toMatchObject({ parentId: "f" });
    expect(beforeB.y - beforeA.y).toBe(board.widgets.get("b")!.y - board.widgets.get("a")!.y);
    expect(beforeB.x - beforeA.x).toBe(board.widgets.get("b")!.x - board.widgets.get("a")!.x);

    board.undoOnce();
    expect(board.widgets.get("a")).toMatchObject({ x: beforeA.x, y: beforeA.y });
    expect(board.widgets.get("a")!.cell).toEqual(beforeCell);
  });

  it("removes the table view but keeps axes and cells for the return", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    expect(removeTable(board, "f")).toBe(true);
    expect(tableLayoutOf(board, "f")!.active).toBe(false);
    expect(board.widgets.get("a")!.cell).toBeDefined();

    expect(showTable(board, "f")).toBe(true);
    expect(tableLayoutOf(board, "f")!.active).toBeUndefined();
    expect(tableLayoutOf(board, "f")!.columns).toHaveLength(layout.columns.length);
  });

  it("sets and clears a fill with the specificity order", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const [first, second] = layout.columns;
    const row = layout.rows[0]!;

    expect(setTableFill(board, "f", { kind: "column", id: first!.id }, "#ff0000")).toBe(true);
    expect(setTableFill(board, "f", { kind: "row", id: row.id }, "#00ff00")).toBe(true);
    expect(
      setTableFill(
        board,
        "f",
        { kind: "cell", rowId: row.id, columnId: first!.id },
        "#0000ff",
      ),
    ).toBe(true);
    const appearance = tableLayoutOf(board, "f")!.appearance!;
    expect(appearance.columns![first!.id]).toBe("#ff0000");
    expect(appearance.rows![row.id]).toBe("#00ff00");
    expect(appearance.cells![`${row.id}:${first!.id}`]).toBe("#0000ff");

    expect(
      setTableFill(board, "f", { kind: "cell", rowId: row.id, columnId: first!.id }, null),
    ).toBe(true);
    expect(tableLayoutOf(board, "f")!.appearance!.cells).toBeUndefined();
    expect(second).toBeDefined();
  });

  it("deletes a section but keeps its objects on the canvas", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const before = board.widgets.get("a")!;

    deleteWidgets(board, ["f"], { keepChildren: true });

    expect(board.widgets.get("f")).toBeUndefined();
    expect(board.widgets.get("a")).toMatchObject({
      parentId: null,
      x: before.x,
      y: before.y,
      content: "a",
    });
    expect(board.widgets.get("a")!.cell).toBeUndefined();
    expect(board.widgets.get("b")!.parentId).toBeNull();

    board.undoOnce();
    expect(board.widgets.get("f")).toBeDefined();
    expect(tableLayoutOf(board, "f")!.columns).toHaveLength(layout.columns.length);
    expect(board.widgets.get("a")!.parentId).toBe("f");
    expect(board.widgets.get("a")!.cell).toBeDefined();
  });

  it("refuses every table edit on a locked section and undo restores nothing", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const frame = board.widgets.get("f")!;
    board.widgets.set("f", { ...frame, locked: true });

    expect(addAxis(board, "f", "column", { title: "Later" })).toBeNull();
    expect(renameAxis(board, "f", layout.columns[0]!.id, "Changed")).toBe(false);
    expect(setAxisSize(board, "f", layout.columns[0]!.id, "wide")).toBe(false);
    expect(setAxisVertical(board, "f", layout.columns[0]!.id, true)).toBe(false);
    expect(moveAxis(board, "f", layout.columns[1]!.id, -1)).toBe(false);
    expect(deleteAxis(board, "f", layout.columns[1]!.id, { mode: "move" })).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(removeTable(board, "f")).toBe(false);
    expect(showTable(board, "f")).toBe(false);
    expect(setTableFill(board, "f", { kind: "table" }, "#ff0000")).toBe(false);
  });

  describe("the section is its table (ADR-201)", () => {
    function inside(board: BoardDocument) {
      const section = board.readWidget("f")!;
      const widgets = board.readWidgets();
      const grid = layoutTable(section, widgets)!;
      // B1: the section box is exactly the grid.
      expect(section.x - section.width / 2).toBe(grid.origin.x);
      expect(section.width).toBe(grid.width);
      expect(section.height).toBe(grid.height);
      // B2: every member lies inside its own cell, padding included.
      for (const widget of widgets.filter((entry) => entry.cell)) {
        const cell = grid.cells.find(
          (entry) =>
            entry.rowId === widget.cell!.rowId && entry.columnId === widget.cell!.columnId,
        )!.rect;
        expect(widget.x - widget.width / 2).toBeGreaterThanOrEqual(cell.x + TABLE_CELL_PADDING);
        expect(widget.y - widget.height / 2).toBeGreaterThanOrEqual(cell.y + TABLE_CELL_PADDING);
        expect(widget.x + widget.width / 2).toBeLessThanOrEqual(cell.x + cell.width);
        expect(widget.y + widget.height / 2).toBeLessThanOrEqual(cell.y + cell.height);
      }
      return { section, grid };
    }

    it("sizes the section to the table as axes come and go, keeping its corner", () => {
      const board = withNotes();
      const corner = { x: -300, y: -200 };
      addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
      let { section } = inside(board);
      expect(section.x - section.width / 2).toBe(corner.x);
      expect(section.y - section.height / 2).toBe(corner.y);
      const before = section.width;
      addAxis(board, "f", "column", { title: "Later" });
      ({ section } = inside(board));
      expect(section.width).toBeGreaterThan(before);
      addAxis(board, "f", "row", { title: "Row 2" });
      const layout = tableLayoutOf(board, "f")!;
      deleteAxis(board, "f", layout.columns[2]!.id, { mode: "move" });
      ({ section } = inside(board));
      expect(section.width).toBe(before);
      expect(section.x - section.width / 2).toBe(corner.x);
    });

    it("grows a cell for a large object and never lets it into the header", () => {
      const board = withNotes();
      addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
      const layout = tableLayoutOf(board, "f")!;
      const a = board.readWidget("a")!;
      setWidgetRects(board, [{ id: "a", x: a.x, y: a.y, width: 420, height: 300 }]);
      inside(board);
      // Dragging a member towards the header inside its cell snaps back to the corner.
      moveWidgets(board, [{ id: "a", x: -900, y: board.readWidget("a")!.y }]);
      expect(board.readWidget("a")!.cell?.columnId).toBeUndefined();
      moveSelectionToCell(board, "f", ["a"], {
        rowId: layout.rows[0]!.id,
        columnId: layout.columns[1]!.id,
      });
      inside(board);
    });

    it("keeps the box when the table is removed and settles again when shown", () => {
      const board = withNotes();
      addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
      const { section } = inside(board);
      removeTable(board, "f");
      expect(board.readWidget("f")).toMatchObject({
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
      });
      showTable(board, "f");
      inside(board);
    });

    it("undoes an axis and its reflow as one step", () => {
      const board = withNotes();
      const before = board.readWidget("f")!;
      const a = board.readWidget("a")!;
      addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
      board.undoOnce();
      expect(board.readWidget("f")).toMatchObject({ width: before.width, height: before.height });
      expect(board.readWidget("a")).toMatchObject({ x: a.x, y: a.y });
    });
  });
});
