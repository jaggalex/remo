import { describe, expect, it } from "vitest";
import type { TableLayout, Widget } from "@remo/model";
import { BoardDocument, loadBoard } from "./board";
import {
  addAxis,
  deleteAxis,
  duplicateAxis,
  mergeCells,
  moveAxis,
  moveSelectionToCell,
  removeTable,
  renameAxis,
  setAxisAutoResize,
  setAxisSize,
  setAxisVertical,
  setTableBorder,
  setTableFill,
  setTableHeaderSize,
  setTablePadding,
  showTable,
  splitCell,
  tableLayoutOf,
} from "./table";
import { deleteWidgets, moveWidgets, setWidgetRects } from "./widgets";
import { applySectionTablePlan, planSectionTable } from "./tablePlan";
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

  it("renames and sizes an axis, and either kind can be vertical", () => {
    const board = withNotes();
    addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
    const layout = tableLayoutOf(board, "f")!;
    const column = layout.columns[1]!;
    const row = layout.rows[0]!;

    expect(renameAxis(board, "f", column.id, "  Later  ")).toBe(true);
    expect(setAxisSize(board, "f", column.id, "wide")).toBe(true);
    expect(setAxisVertical(board, "f", column.id, true)).toBe(true);
    expect(setAxisVertical(board, "f", row.id, true)).toBe(true);

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

    it("keeps an object's own offset inside its cell", () => {
      const board = withNotes();
      addAxis(board, "f", "column", { title: "Next", firstTitle: "Now", oppositeTitle: "Row" });
      const layout = tableLayoutOf(board, "f")!;
      const grid = layoutTable(board.readWidget("f")!, board.readWidgets())!;
      const cell = grid.cells.find(
        (entry) =>
          entry.rowId === layout.rows[0]!.id && entry.columnId === layout.columns[0]!.id,
      )!.rect;
      const a = board.readWidget("a")!;
      const target = {
        x: cell.x + cell.width - a.width / 2 - 8,
        y: cell.y + cell.height - a.height / 2 - 8,
      };
      moveWidgets(board, [{ id: "a", x: target.x, y: target.y }]);
      expect(board.readWidget("a")).toMatchObject(target);
      inside(board);
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

describe("merged blocks (ADR-204)", () => {
  function boardWithBlock(): BoardDocument {
    const layout: TableLayout = {
      kind: "table",
      columns: [
        { id: "c1", title: "A" },
        { id: "c2", title: "B" },
      ],
      rows: [
        { id: "r1", title: "1" },
        { id: "r2", title: "2" },
      ],
    };
    return boardWith([
      { ...frame(), layout },
      { ...note("a", 0), cell: { rowId: "r1", columnId: "c1" } },
      { ...note("b", 100), cell: { rowId: "r1", columnId: "c2" } },
    ]);
  }

  it("merges a rectangle, moves members to the anchor and keeps one undo", () => {
    const board = boardWithBlock();
    const result = mergeCells(board, "f", [
      { rowId: "r1", columnId: "c1" },
      { rowId: "r1", columnId: "c2" },
    ]);
    expect(result).toMatchObject({ ok: true, rowSpan: 1, columnSpan: 2, moved: ["b"] });
    expect(tableLayoutOf(board, "f")!.spans).toEqual([
      { rowId: "r1", columnId: "c1", rowSpan: 1, columnSpan: 2 },
    ]);
    expect(board.widgets.get("b")!.cell).toEqual({ rowId: "r1", columnId: "c1" });
    expect(board.widgets.get("a")!.cell).toEqual({ rowId: "r1", columnId: "c1" });
    board.undoOnce();
    expect(tableLayoutOf(board, "f")!.spans).toBeUndefined();
    expect(board.widgets.get("b")!.cell).toEqual({ rowId: "r1", columnId: "c2" });
  });

  it("refuses a single cell and a diagonal pair", () => {
    const board = boardWithBlock();
    expect(mergeCells(board, "f", [{ rowId: "r1", columnId: "c1" }])).toEqual({
      ok: false,
      reason: "few",
    });
    expect(
      mergeCells(board, "f", [
        { rowId: "r1", columnId: "c1" },
        { rowId: "r2", columnId: "c2" },
      ]),
    ).toEqual({ ok: false, reason: "shape" });
    expect(tableLayoutOf(board, "f")!.spans).toBeUndefined();
  });

  it("merges the whole block when the selection names a covered cell", () => {
    const board = boardWithBlock();
    mergeCells(board, "f", [
      { rowId: "r1", columnId: "c1" },
      { rowId: "r1", columnId: "c2" },
    ]);
    const grown = mergeCells(board, "f", [
      { rowId: "r1", columnId: "c2" },
      { rowId: "r2", columnId: "c1" },
      { rowId: "r2", columnId: "c2" },
    ]);
    expect(grown).toMatchObject({ ok: true, rowSpan: 2, columnSpan: 2 });
    expect(tableLayoutOf(board, "f")!.spans).toEqual([
      { rowId: "r1", columnId: "c1", rowSpan: 2, columnSpan: 2 },
    ]);
  });

  it("splits by a covered cell and keeps the objects in the anchor", () => {
    const board = boardWithBlock();
    mergeCells(board, "f", [
      { rowId: "r1", columnId: "c1" },
      { rowId: "r1", columnId: "c2" },
    ]);
    expect(splitCell(board, "f", "r1", "c2")).toBe(true);
    expect(tableLayoutOf(board, "f")!.spans).toBeUndefined();
    expect(board.widgets.get("b")!.cell).toEqual({ rowId: "r1", columnId: "c1" });
    expect(splitCell(board, "f", "r1", "c2")).toBe(false);
  });

  it("extends a block on insert, shrinks it on delete and releases it on move", () => {
    const board = boardWithBlock();
    mergeCells(board, "f", [
      { rowId: "r1", columnId: "c1" },
      { rowId: "r1", columnId: "c2" },
    ]);
    addAxis(board, "f", "column", { title: "C", afterId: "c1" });
    expect(tableLayoutOf(board, "f")!.spans![0]).toMatchObject({ columnSpan: 3 });

    const newest = tableLayoutOf(board, "f")!.columns[1]!.id;
    deleteAxis(board, "f", newest, { mode: "move" });
    expect(tableLayoutOf(board, "f")!.spans![0]).toMatchObject({ columnSpan: 2 });

    moveAxis(board, "f", "c2", -1);
    expect(tableLayoutOf(board, "f")!.spans).toBeUndefined();
  });

  it("releases the block when its anchor axis is deleted", () => {
    const board = boardWithBlock();
    mergeCells(board, "f", [
      { rowId: "r1", columnId: "c1" },
      { rowId: "r2", columnId: "c1" },
    ]);
    expect(tableLayoutOf(board, "f")!.spans).toHaveLength(1);
    deleteAxis(board, "f", "r1", { mode: "move" });
    expect(tableLayoutOf(board, "f")!.spans).toBeUndefined();
  });
});

describe("duplicating an axis (ADR-196)", () => {
  function boardWithColumn(): BoardDocument {
    const layout: TableLayout = {
      kind: "table",
      columns: [
        { id: "c1", title: "A" },
        { id: "c2", title: "B" },
      ],
      rows: [
        { id: "r1", title: "1" },
        { id: "r2", title: "2" },
        { id: "r3", title: "3" },
      ],
    };
    return boardWith([
      { ...frame(), layout },
      { ...note("a", 0), cell: { rowId: "r1", columnId: "c1" } },
      { ...note("b", 100), cell: { rowId: "r2", columnId: "c1" } },
    ]);
  }

  it("copies the column, its objects and their rows in one undo", () => {
    const board = boardWithColumn();
    const copy = duplicateAxis(board, "f", "column", "c1", { title: "A copy" })!;
    const layout = tableLayoutOf(board, "f")!;
    expect(layout.columns.map((axis) => axis.title)).toEqual(["A", "A copy", "B"]);
    const copies = board
      .readWidgets()
      .filter((widget) => widget.cell?.columnId === copy)
      .sort((left, right) => left.y - right.y);
    expect(copies).toHaveLength(2);
    expect(copies.map((widget) => widget.cell!.rowId)).toEqual(["r1", "r2"]);
    expect(copies.map((widget) => widget.content)).toEqual(["a", "b"]);
    expect(copies.some((widget) => widget.id === "a" || widget.id === "b")).toBe(false);
    board.undoOnce();
    expect(tableLayoutOf(board, "f")!.columns).toHaveLength(2);
    expect(board.readWidgets().filter((widget) => widget.cell?.columnId === copy)).toHaveLength(0);
  });

  it("duplicates an empty row without inventing objects", () => {
    const board = boardWithColumn();
    const before = board.readWidgets().length;
    const copy = duplicateAxis(board, "f", "row", "r3", { title: "3 copy" })!;
    expect(tableLayoutOf(board, "f")!.rows.map((axis) => axis.id)).toEqual([
      "r1",
      "r2",
      "r3",
      copy,
    ]);
    expect(board.readWidgets()).toHaveLength(before);
  });
});

describe("spans and axis moves (ADR-204)", () => {
  it("releases a block when a move puts another axis under it", () => {
    const layout: TableLayout = {
      kind: "table",
      columns: [
        { id: "c1", title: "A" },
        { id: "c2", title: "B" },
        { id: "c3", title: "C" },
      ],
      rows: [{ id: "r1", title: "1" }],
    };
    const board = boardWith([{ ...frame(), layout }]);
    mergeCells(board, "f", [
      { rowId: "r1", columnId: "c1" },
      { rowId: "r1", columnId: "c2" },
    ]);
    expect(tableLayoutOf(board, "f")!.spans).toHaveLength(1);
    moveAxis(board, "f", "c3", -1);
    expect(tableLayoutOf(board, "f")!.columns.map((axis) => axis.id)).toEqual([
      "c1",
      "c3",
      "c2",
    ]);
    expect(tableLayoutOf(board, "f")!.spans).toBeUndefined();
  });
});

describe("auto resize of an axis (ADR-201)", () => {
  function boardWithWideNote(): { board: BoardDocument; frameId: string; noteId: string } {
    const layout: TableLayout = {
      kind: "table",
      columns: [
        { id: "c1", title: "A" },
        { id: "c2", title: "B" },
      ],
      rows: [{ id: "r1", title: "1" }],
    };
    const board = boardWith([
      { ...frame(), layout },
      { ...note("wide", 0, 0), width: 320, height: 100, cell: { rowId: "r1", columnId: "c1" } },
    ]);
    return { board, frameId: "f", noteId: "wide" };
  }

  it("freezes the visible width when auto is turned off", () => {
    const { board } = boardWithWideNote();
    const before = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    const width = Math.round(before.columns[0]!.width);
    expect(width).toBeGreaterThanOrEqual(320);
    expect(setAxisAutoResize(board, "f", "c1", false)).toBe(true);
    expect(tableLayoutOf(board, "f")!.columns[0]!.size).toBe(width);
    // The same visible size after the switch: nothing jumps on screen.
    const after = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    expect(Math.round(after.columns[0]!.width)).toBe(width);
  });

  it("keeps the frozen width when the content shrinks, and follows again when auto returns", () => {
    const { board } = boardWithWideNote();
    setAxisAutoResize(board, "f", "c1", false);
    const frozen = tableLayoutOf(board, "f")!.columns[0]!.size as number;
    board.widgets.set("wide", { ...board.widgets.get("wide")!, width: 40 });
    const shrunk = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    expect(Math.round(shrunk.columns[0]!.width)).toBe(frozen);
    expect(setAxisAutoResize(board, "f", "c1", true)).toBe(true);
    expect(tableLayoutOf(board, "f")!.columns[0]!.size).toBeUndefined();
    const auto = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    expect(Math.round(auto.columns[0]!.width)).toBeLessThan(frozen);
  });

  it("still grows a frozen axis to hold a bigger object", () => {
    const { board } = boardWithWideNote();
    setAxisAutoResize(board, "f", "c1", false);
    const frozen = tableLayoutOf(board, "f")!.columns[0]!.size as number;
    board.widgets.set("wide", { ...board.widgets.get("wide")!, width: 600 });
    const grown = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    expect(Math.round(grown.columns[0]!.width)).toBeGreaterThanOrEqual(600);
    expect(tableLayoutOf(board, "f")!.columns[0]!.size).toBe(frozen);
  });
});

describe("R1: a block follows its axes (ADR-206)", () => {
  it("shrinks the block by the deleted axis and keeps the surviving widths", () => {
    const layout: TableLayout = {
      kind: "table",
      columns: [
        { id: "c1", title: "A", size: 200 },
        { id: "c2", title: "B", size: 300 },
        { id: "c3", title: "C", size: 250 },
      ],
      rows: [{ id: "r1", title: "1" }],
      spans: [{ rowId: "r1", columnId: "c1", rowSpan: 1, columnSpan: 3 }],
    };
    const board = boardWith([{ ...frame(), layout }]);
    const before = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    const beforeWidths = before.columns.map((column) => Math.round(column.width));
    expect(beforeWidths).toEqual([200, 300, 250]);

    deleteAxis(board, "f", "c2", { mode: "move" });

    const after = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    expect(after.columns.map((column) => column.axis.id)).toEqual(["c1", "c3"]);
    expect(after.columns.map((column) => Math.round(column.width))).toEqual([200, 250]);
    expect(tableLayoutOf(board, "f")!.spans).toEqual([
      { rowId: "r1", columnId: "c1", rowSpan: 1, columnSpan: 2 },
    ]);
    expect(after.cells).toHaveLength(1);
    expect(Math.round(after.cells[0]!.rect.width)).toBe(450);
  });
});

describe("section table plan (ADR-207)", () => {
  const titles = { column1: "Column 1", column2: "Column 2", row1: "Row 1" };

  it("keeps every object in the first cell by default", () => {
    const board = boardWith([
      frame(),
      note("a", -100),
      note("b", 100),
      note("c", 300),
    ]);
    const plan = planSectionTable(board.widgets.get("f")!, board.readWidgets(), "first", titles);
    expect(plan.layout.columns.map((axis) => axis.title)).toEqual(["Column 1", "Column 2"]);
    expect(plan.cells.map((entry) => entry.cell.columnId)).toEqual([
      plan.layout.columns[0]!.id,
      plan.layout.columns[0]!.id,
      plan.layout.columns[0]!.id,
    ]);
  });

  it("splits the material into two columns by x when asked", () => {
    const board = boardWith([
      frame(),
      note("a", -100),
      note("b", 100),
      note("c", 300),
    ]);
    const plan = planSectionTable(board.widgets.get("f")!, board.readWidgets(), "position", titles);
    const [first, second] = plan.layout.columns;
    expect(plan.cells.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(plan.cells[0]!.cell.columnId).toBe(first!.id);
    expect(plan.cells[1]!.cell.columnId).toBe(first!.id);
    expect(plan.cells[2]!.cell.columnId).toBe(second!.id);
  });

  it("applies the plan as one transaction and refuses an existing table", () => {
    const board = boardWith([frame(), note("a", -100), note("b", 100)]);
    const plan = planSectionTable(board.widgets.get("f")!, board.readWidgets(), "position", titles);
    expect(applySectionTablePlan(board, "f", plan)).toBe(true);
    expect(tableLayoutOf(board, "f")!.columns).toHaveLength(2);
    expect(board.widgets.get("b")!.cell!.columnId).toBe(plan.layout.columns[1]!.id);
    expect(applySectionTablePlan(board, "f", plan)).toBe(false);
    board.undoOnce();
    expect(tableLayoutOf(board, "f")).toBeNull();
  });
});

describe("borders and paddings (ADR-208)", () => {
  function boardWithTable(): BoardDocument {
    const layout: TableLayout = {
      kind: "table",
      columns: [{ id: "c1", title: "A" }],
      rows: [{ id: "r1", title: "1" }],
    };
    return boardWith([
      { ...frame(), layout },
      { ...note("a", 0), cell: { rowId: "r1", columnId: "c1" } },
    ]);
  }

  it("sets and clears one cell border without touching the fills", () => {
    const board = boardWithTable();
    setTableFill(board, "f", { kind: "table" }, "#eeeeee");
    expect(
      setTableBorder(board, "f", { kind: "cell", rowId: "r1", columnId: "c1" }, {
        color: "#123456",
        width: 2,
        style: "dashed",
      }),
    ).toBe(true);
    expect(tableLayoutOf(board, "f")!.appearance).toEqual({
      table: "#eeeeee",
      borders: {
        cells: { "r1:c1": { color: "#123456", width: 2, style: "dashed" } },
      },
    });
    expect(
      setTableBorder(board, "f", { kind: "cell", rowId: "r1", columnId: "c1" }, null),
    ).toBe(true);
    expect(tableLayoutOf(board, "f")!.appearance?.borders).toBeUndefined();
    expect(tableLayoutOf(board, "f")!.appearance?.table).toBe("#eeeeee");
  });

  it("rejects a border width outside 1-8 instead of clamping it", () => {
    const board = boardWithTable();
    const target = { kind: "cell", rowId: "r1", columnId: "c1" } as const;
    expect(setTableBorder(board, "f", target, { color: "#123456", width: 0, style: "solid" })).toBe(
      false,
    );
    expect(setTableBorder(board, "f", target, { color: "#123456", width: 9, style: "solid" })).toBe(
      false,
    );
    expect(
      setTableBorder(board, "f", target, {
        color: "#123456",
        width: Number.NaN,
        style: "solid",
      }),
    ).toBe(false);
    expect(tableLayoutOf(board, "f")!.appearance?.borders).toBeUndefined();
  });

  it("changes the cell width through padding", () => {
    const board = boardWithTable();
    const before = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    const beforeWidth = Math.round(before.columns[0]!.width);
    expect(
      setTablePadding(board, "f", { kind: "cell", rowId: "r1", columnId: "c1" }, 48),
    ).toBe(true);
    const after = layoutTable(board.widgets.get("f")!, board.readWidgets())!;
    expect(Math.round(after.columns[0]!.width)).toBeGreaterThan(beforeWidth);
    expect(tableLayoutOf(board, "f")!.appearance?.paddings).toEqual({
      cells: { "r1:c1": 48 },
    });
  });
});

describe("header size and vertical rows (ADR-217)", () => {
  it("allows a vertical row header and a manual header size", () => {
    const board = boardWith([
      {
        ...frame(),
        layout: {
          kind: "table",
          columns: [{ id: "c1", title: "A" }],
          rows: [{ id: "r1", title: "1" }],
        },
      },
    ]);
    expect(setAxisVertical(board, "f", "r1", true)).toBe(true);
    expect(tableLayoutOf(board, "f")!.rows[0]!.vertical).toBe(true);
    expect(setTableHeaderSize(board, "f", "width", 220)).toBe(true);
    expect(setTableHeaderSize(board, "f", "height", 140)).toBe(true);
    expect(tableLayoutOf(board, "f")!.headerWidth).toBe(220);
    expect(tableLayoutOf(board, "f")!.headerHeight).toBe(140);
    expect(setTableHeaderSize(board, "f", "width", null)).toBe(true);
    expect(tableLayoutOf(board, "f")!.headerWidth).toBeUndefined();
  });
});
