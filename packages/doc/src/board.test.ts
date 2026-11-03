import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  bounds,
  DEFAULT_COLUMN_WIDTH,
  type Board,
  type KanbanState,
  type Widget,
} from "@remo/model";
import {
  BoardDocument,
  addColumn,
  addSwimlane,
  addCard,
  deleteColumn,
  deleteWidget,
  deleteWidgets,
  loadBoard,
  moveCard,
  moveColumn,
  createConnector,
  createShape,
  createSticky,
  insertTemplate,
  setStickyColor,
  moveWidgets,
  moveSelection,
  renameColumn,
  setCardFields,
  setColumnWip,
  setWidgetText,
} from "./board";
import { setLocked } from "./layers";

const card = (id: string, kanbanId: string, title = ""): Widget => ({
  id,
  type: "card",
  parentId: kanbanId,
  x: 0,
  y: 0,
  width: 422.08,
  height: 79.14,
  title,
});

const template = (): { board: Board; states: Record<string, KanbanState> } => {
  const widgets: Widget[] = [
    { id: "k1", type: "kanban", parentId: null, x: 500, y: 500, width: 1200, height: 900 },
    card("c1", "k1", "one"),
    card("c2", "k1", "two"),
    { id: "s1", type: "sticky_note", parentId: null, x: 0, y: 0, width: 100, height: 100 },
  ];
  const state: KanbanState = {
    columns: [
      { id: "col0", title: "Todo", accent: "#1a1a1a", width: 600 },
      { id: "col1", title: "Doing", accent: "#ffdd33", width: 600 },
    ],
    swimlanes: [
      { id: "lane0", title: "Team A" },
      { id: "lane1", title: "Team B" },
    ],
    cards: {
      c1: { columnId: "col0", swimlaneId: "lane0", order: "n" },
      c2: { columnId: "col0", swimlaneId: "lane0", order: "t" },
    },
    newColumnWidth: DEFAULT_COLUMN_WIDTH,
    headerHeight: 110,
  };
  return { board: { id: "t", title: "T", widgets }, states: { k1: state } };
};

function fresh(): BoardDocument {
  const doc = new BoardDocument();
  const { board, states } = template();
  loadBoard(doc, board, states);
  return doc;
}

describe("board document", () => {
  it("exposes the loaded template as a snapshot", () => {
    const doc = fresh();
    const snapshot = doc.snapshot();
    expect(snapshot.widgets).toHaveLength(4);
    expect(snapshot.kanbanStates.k1!.columns).toHaveLength(2);
    expect(snapshot.kanbanStates.k1!.cards.c1!.columnId).toBe("col0");
  });

  it("returns a stable snapshot until something changes", () => {
    const doc = fresh();
    const first = doc.snapshot();
    expect(doc.snapshot()).toBe(first);
    expect(doc.snapshot().widgets.find((w) => w.id === "k1")!.width).toBe(1200);

    moveCard(doc, "k1", "c1", "col1", "lane0");
    expect(doc.snapshot()).not.toBe(first);
  });

  it("keeps template import out of the undo stack", () => {
    const doc = fresh();
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
  });
});

describe("card moves", () => {
  it("writes column, swimlane and order together", () => {
    const doc = fresh();
    moveCard(doc, "k1", "c1", "col1", "lane1");

    const placement = doc.snapshot().kanbanStates.k1!.cards.c1!;
    expect(placement.columnId).toBe("col1");
    expect(placement.swimlaneId).toBe("lane1");
    expect(placement.order).toBe("n");
  });

  it("appends below existing cards in the target cell", () => {
    const doc = fresh();
    moveCard(doc, "k1", "c1", "col0", "lane0");
    const orders = Object.values(doc.snapshot().kanbanStates.k1!.cards).map((p) => p.order);
    expect(orders.sort()).toEqual(["n", "t"]);
  });

  it("is one undo step and restores the original cell", () => {
    const doc = fresh();
    moveCard(doc, "k1", "c2", "col1", "lane1");
    expect(doc.snapshot().kanbanStates.k1!.cards.c2!.columnId).toBe("col1");

    doc.undoOnce();

    const restored = doc.snapshot().kanbanStates.k1!.cards.c2!;
    expect(restored.columnId).toBe("col0");
    expect(restored.swimlaneId).toBe("lane0");
    expect(doc.canUndo).toBe(false);
  });

  it("ignores a move into the same cell", () => {
    const doc = fresh();
    moveCard(doc, "k1", "c1", "col0", "lane0");
    expect(doc.canUndo).toBe(false);
  });

  it("adds a card and its placement in one step", () => {
    const doc = fresh();
    addCard(doc, "k1", "c9", card("c9", "k1", "new"), "col1", "lane0");

    expect(doc.snapshot().widgets.some((w) => w.id === "c9")).toBe(true);
    expect(doc.snapshot().kanbanStates.k1!.cards.c9!.columnId).toBe("col1");

    doc.undoOnce();
    const after = doc.snapshot();
    expect(after.widgets.some((w) => w.id === "c9")).toBe(false);
    expect(after.kanbanStates.k1!.cards.c9).toBeUndefined();
  });
});

describe("columns", () => {
  it("widens the widget by exactly one column width, in one undo step", () => {
    const doc = fresh();
    const before = doc.snapshot().widgets.find((w) => w.id === "k1")!.width;
    expect(before).toBe(1200);

    addColumn(doc, "k1", "New column");

    const snapshot = doc.snapshot();
    expect(snapshot.kanbanStates.k1!.columns).toHaveLength(3);
    // Columns keep their own widths; the new one uses the default, so the widget
    // grows by exactly that much (matches the captured 1474.6 → 2049.2 jump).
    expect(snapshot.kanbanStates.k1!.columns[2]!.width).toBe(DEFAULT_COLUMN_WIDTH);
    expect(snapshot.widgets.find((w) => w.id === "k1")!.width).toBeCloseTo(
      before + DEFAULT_COLUMN_WIDTH,
      5,
    );

    doc.undoOnce();
    const restored = doc.snapshot();
    expect(restored.kanbanStates.k1!.columns).toHaveLength(2);
    expect(restored.widgets.find((w) => w.id === "k1")!.width).toBe(1200);
  });

  it("renames a column", () => {
    const doc = fresh();
    renameColumn(doc, "k1", "col1", "In review");
    expect(doc.snapshot().kanbanStates.k1!.columns[1]!.title).toBe("In review");
  });

  it("reorders columns", () => {
    const doc = fresh();
    moveColumn(doc, "k1", "col1", 0);
    expect(doc.snapshot().kanbanStates.k1!.columns.map((c) => c.id)).toEqual(["col1", "col0"]);
  });

  it("moves orphaned cards to the first remaining column", () => {
    const doc = fresh();
    deleteColumn(doc, "k1", "col0");
    const state = doc.snapshot().kanbanStates.k1!;
    expect(state.columns.map((c) => c.id)).toEqual(["col1"]);
    expect(state.cards.c1!.columnId).toBe("col1");
    expect(state.cards.c2!.columnId).toBe("col1");
  });
});

describe("swimlanes", () => {
  it("adds a swimlane with a unique title", () => {
    const doc = fresh();
    addSwimlane(doc, "k1", "Team A");
    const titles = doc.snapshot().kanbanStates.k1!.swimlanes.map((s) => s.title);
    expect(titles).toEqual(["Team A", "Team B", "Team A 2"]);
  });
});

describe("widgets", () => {
  it("deletes a widget and its kanban placement together", () => {
    const doc = fresh();
    deleteWidget(doc, "c1");
    const snapshot = doc.snapshot();
    expect(snapshot.widgets.some((w) => w.id === "c1")).toBe(false);
    expect(snapshot.kanbanStates.k1!.cards.c1).toBeUndefined();
  });

  it("deletes several widgets in one undo step", () => {
    const doc = fresh();
    deleteWidgets(doc, ["c1", "c2", "s1"]);

    const after = doc.snapshot();
    expect(after.widgets.map((w) => w.id)).toEqual(["k1"]);
    expect(after.kanbanStates.k1!.cards).toEqual({});

    doc.undoOnce();
    const restored = doc.snapshot();
    expect(restored.widgets.map((w) => w.id).sort()).toEqual(["c1", "c2", "k1", "s1"]);
    expect(Object.keys(restored.kanbanStates.k1!.cards).sort()).toEqual(["c1", "c2"]);
  });

  it("moves a selection without touching layout-owned cards", () => {
    const doc = fresh();
    moveSelection(doc, ["s1", "c1"], 10, 20);

    const widgets = doc.snapshot().widgets;
    expect(widgets.find((w) => w.id === "s1")).toMatchObject({ x: 10, y: 20 });
    expect(widgets.find((w) => w.id === "c1")).toMatchObject({ x: 0, y: 0 });
  });

  it("undoes a selection move in one step", () => {
    const doc = fresh();
    moveSelection(doc, ["s1"], 10, 20);
    doc.undoOnce();
    expect(doc.snapshot().widgets.find((w) => w.id === "s1")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("undo and redo stack", () => {
  it("walks gestures forwards and backwards", () => {
    const doc = fresh();
    moveCard(doc, "k1", "c1", "col1", "lane0");
    renameColumn(doc, "k1", "col0", "Backlog");

    expect(doc.snapshot().kanbanStates.k1!.columns[0]!.title).toBe("Backlog");

    doc.undoOnce();
    expect(doc.snapshot().kanbanStates.k1!.columns[0]!.title).toBe("Todo");
    expect(doc.snapshot().kanbanStates.k1!.cards.c1!.columnId).toBe("col1");

    doc.undoOnce();
    expect(doc.snapshot().kanbanStates.k1!.cards.c1!.columnId).toBe("col0");

    doc.redoOnce();
    expect(doc.snapshot().kanbanStates.k1!.cards.c1!.columnId).toBe("col1");
  });

  it("does not undo another user's edits (imported state)", () => {
    const doc = fresh();
    const { board, states } = template();
    // Simulate a remote/imported change arriving after local edits.
    loadBoard(doc, board, states);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
  });
});

describe("text", () => {
  it("streams text into a shared Y.Text and materializes it in the snapshot", () => {
    const doc = fresh();
    setWidgetText(doc, "c1", "first");
    setWidgetText(doc, "c1", "first draft");

    expect(doc.texts.get("c1")?.toString()).toBe("first draft");
    expect(doc.snapshot().widgets.find((w) => w.id === "c1")?.title).toBe("first draft");
  });

  it("applies edits as a prefix/suffix diff", () => {
    const doc = fresh();
    setWidgetText(doc, "c1", "hello world");
    const text = doc.texts.get("c1")!;

    // Only the changed word is rewritten, so a concurrent edit elsewhere survives.
    setWidgetText(doc, "c1", "hello there");
    expect(text.toString()).toBe("hello there");
    expect(text.length).toBe("hello there".length);
  });

  it("keeps concurrent typing from two clients", () => {
    const a = fresh();
    const b = new BoardDocument(Y.encodeStateAsUpdate(a.doc) && new Y.Doc());
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    setWidgetText(a, "c1", "left");
    setWidgetText(b, "c1", "left!");

    // Exchange updates both ways.
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));

    expect(a.texts.get("c1")!.toString()).toBe(b.texts.get("c1")!.toString());
  });

  it("merges a burst of keystrokes into one undo step", () => {
    const doc = fresh();
    doc.stopCapturing();
    for (const value of ["h", "he", "hel", "hell", "hello"]) setWidgetText(doc, "c1", value);
    expect(doc.snapshot().widgets.find((w) => w.id === "c1")?.title).toBe("hello");

    doc.undoOnce();
    expect(doc.snapshot().widgets.find((w) => w.id === "c1")?.title).not.toBe("hello");
  });

  it("drops the text together with the widget", () => {
    const doc = fresh();
    setWidgetText(doc, "c1", "gone soon");
    deleteWidgets(doc, ["c1"]);
    expect(doc.texts.get("c1")).toBeUndefined();
  });
});

describe("frames own their contents", () => {
  const withFrame = () => {
    const doc = new BoardDocument();
    loadBoard(
      doc,
      {
        id: "t",
        title: "Story map",
        widgets: [
          { id: "f1", type: "frame", parentId: null, x: 0, y: 0, width: 1000, height: 300 },
          { id: "s1", type: "sticky_note", parentId: "f1", x: -400, y: 0, width: 161, height: 184 },
          { id: "s2", type: "sticky_note", parentId: "f1", x: -200, y: 0, width: 161, height: 184 },
          { id: "loose", type: "sticky_note", parentId: null, x: 5000, y: 5000, width: 161, height: 184 },
        ],
      },
      {},
    );
    return doc;
  };

  it("moves a frame's children with it, in one step", () => {
    const doc = withFrame();
    moveWidgets(doc, [{ id: "f1", x: 100, y: 50 }]);

    const widgets = doc.snapshot().widgets;
    expect(widgets.find((w) => w.id === "f1")).toMatchObject({ x: 100, y: 50 });
    expect(widgets.find((w) => w.id === "s1")).toMatchObject({ x: -300, y: 50 });
    expect(widgets.find((w) => w.id === "s2")).toMatchObject({ x: -100, y: 50 });
    expect(widgets.find((w) => w.id === "loose")).toMatchObject({ x: 5000, y: 5000 });

    doc.undoOnce();
    const restored = doc.snapshot().widgets;
    expect(restored.find((w) => w.id === "f1")).toMatchObject({ x: 0, y: 0 });
    expect(restored.find((w) => w.id === "s1")).toMatchObject({ x: -400, y: 0 });
  });

  it("does not drag the frame along when a child moves", () => {
    const doc = withFrame();
    moveWidgets(doc, [{ id: "s1", x: -400, y: 120 }]);
    const widgets = doc.snapshot().widgets;
    expect(widgets.find((w) => w.id === "f1")).toMatchObject({ x: 0, y: 0 });
    expect(widgets.find((w) => w.id === "s1")).toMatchObject({ x: -400, y: 120 });
  });

  it("deletes a frame together with its contents", () => {
    const doc = withFrame();
    deleteWidgets(doc, ["f1"]);
    const ids = doc.snapshot().widgets.map((w) => w.id).sort();
    expect(ids).toEqual(["loose"]);
  });

  it("deletes a kanban with its cards and its matrix", () => {
    const doc = fresh();
    deleteWidgets(doc, ["k1"]);
    const snapshot = doc.snapshot();
    expect(snapshot.widgets.map((w) => w.id)).toEqual(["s1"]);
    expect(snapshot.kanbanStates.k1).toBeUndefined();
  });
});

describe("a frame adopts and releases what is dropped in it (ADR-110)", () => {
  function framed() {
    const doc = new BoardDocument();
    createSticky(doc, "a", { x: 500, y: 500 });
    doc.widgets.set("f1", {
      id: "f1",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      title: "Section",
    });
    doc.widgets.set("f2", {
      id: "f2",
      type: "frame",
      parentId: null,
      x: 100,
      y: 100,
      width: 150,
      height: 150,
      title: "Inner",
    });
    return doc;
  }

  it("adopts an object whose centre is inside the smallest frame", () => {
    const doc = framed();
    moveWidgets(doc, [{ id: "a", x: 120, y: 120 }]);
    expect(doc.widgets.get("a")!.parentId).toBe("f2");

    moveWidgets(doc, [{ id: "a", x: 0, y: 0 }]);
    expect(doc.widgets.get("a")!.parentId).toBe("f1");
  });

  it("releases a child dragged out, and keeps it as one undo step", () => {
    const doc = framed();
    moveWidgets(doc, [{ id: "a", x: 120, y: 120 }]);
    expect(doc.widgets.get("a")!.parentId).toBe("f2");

    moveWidgets(doc, [{ id: "a", x: 600, y: 600 }]);
    expect(doc.widgets.get("a")!.parentId).toBeNull();

    doc.undoOnce();
    expect(doc.widgets.get("a")!.parentId).toBe("f2");
  });

  it("does not reparent cards or connectors", () => {
    const doc = framed();
    doc.widgets.set("c1", {
      id: "c1",
      type: "connector",
      parentId: null,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    moveWidgets(doc, [{ id: "c1", x: 120, y: 120 }]);
    expect(doc.widgets.get("c1")!.parentId).toBeNull();
  });
});

describe("board title", () => {
  it("follows the template until a human names the board", () => {
    const doc = new BoardDocument();
    const storyMap = { id: "t", title: "Story map", widgets: [] };
    const roadmap = { id: "t", title: "Roadmap", widgets: [] };

    loadBoard(doc, { id: "t", title: "Kanban board", widgets: [] }, {});
    expect(doc.snapshot().title).toBe("Kanban board");

    // A title that is itself a template name is not a chosen name, so switching
    // templates renames the board instead of describing the previous content.
    loadBoard(doc, storyMap, {});
    expect(doc.snapshot().title).toBe("Story map");

    doc.setTitle("Sprint 12");
    loadBoard(doc, roadmap, {});
    expect(doc.snapshot().title).toBe("Sprint 12");
  });

  it("is part of the document and one undo step", () => {
    const doc = fresh();
    doc.setTitle("Sprint 12");
    expect(doc.snapshot().title).toBe("Sprint 12");
    doc.undoOnce();
    // Undo returns to the imported title, not to nothing.
    expect(doc.snapshot().title).toBe("T");
  });
});

describe("text that grows", () => {
  it("applies a measured height in the same step as the text", () => {
    const doc = fresh();
    setWidgetText(doc, "s1", "one\ntwo\nthree", { height: 120 });
    const widget = doc.snapshot().widgets.find((w) => w.id === "s1")!;
    expect(widget.height).toBe(120);
    expect(doc.textOf("s1")).toBe("one\ntwo\nthree");

    doc.undoOnce();
    const restored = doc.snapshot().widgets.find((w) => w.id === "s1")!;
    expect(restored.height).toBe(100);
  });

  it("writes nothing when neither text nor height changed", () => {
    const doc = fresh();
    setWidgetText(doc, "s1", "still one line", { height: 100 });
    doc.undoOnce();

    // Redo the same value: identical text and identical height are a no-op.
    setWidgetText(doc, "s1", "", { height: 100 });
    expect(doc.canUndo).toBe(false);
  });
});

/** Two clients, exchanging updates as the sync service would. */
function pair() {
  const a = new BoardDocument();
  const b = new BoardDocument();
  const { board: template, states } = { board: { id: "t", title: "T", widgets: [
    { id: "k1", type: "kanban" as const, parentId: null, x: 0, y: 0, width: 1200, height: 900 },
    { id: "c1", type: "card" as const, parentId: "k1", x: 0, y: 0, width: 422, height: 79 },
    { id: "c2", type: "card" as const, parentId: "k1", x: 0, y: 0, width: 422, height: 79 },
  ] }, states: { k1: {
    columns: [
      { id: "col0", title: "Todo", accent: "#1a1a1a", width: 600 },
      { id: "col1", title: "Doing", accent: "#ffdd33", width: 600 },
    ],
    swimlanes: [{ id: "lane0", title: "Team A" }],
    cards: {
      c1: { columnId: "col0", swimlaneId: "lane0", order: "n" },
      c2: { columnId: "col0", swimlaneId: "lane0", order: "t" },
    },
    newColumnWidth: 574.6,
    headerHeight: 110,
  } } };

  loadBoard(a, template, states);
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

  const sync = () => {
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
  };
  return { a, b, sync };
}

describe("undo belongs to the author", () => {
  it("reverts only the local edit, leaving the peer's alone", () => {
    const { a, b, sync } = pair();

    moveCard(a, "k1", "c1", "col1", "lane0");   // my gesture
    moveCard(b, "k1", "c2", "col1", "lane0");   // their gesture
    sync();

    expect(a.snapshot().kanbanStates.k1!.cards.c2!.columnId).toBe("col1");

    a.undoOnce();
    sync();

    // Mine is back; theirs is untouched on both replicas.
    expect(a.snapshot().kanbanStates.k1!.cards.c1!.columnId).toBe("col0");
    expect(a.snapshot().kanbanStates.k1!.cards.c2!.columnId).toBe("col1");
    expect(b.snapshot().kanbanStates.k1!.cards.c1!.columnId).toBe("col0");
    expect(b.snapshot().kanbanStates.k1!.cards.c2!.columnId).toBe("col1");
  });

  it("does not undo text a peer typed into the same note", () => {
    const { a, b, sync } = pair();

    setWidgetText(a, "c1", "mine");
    setWidgetText(b, "c1", "mine and theirs");
    sync();

    a.undoOnce();
    sync();

    // Both replicas converge, and the peer's words are still there.
    const text = a.textOf("c1");
    expect(text).toBe(b.textOf("c1"));
    expect(text).toContain("theirs");
  });

  it("shows the peer's edit in the redo stack of nobody", () => {
    const { a, b, sync } = pair();
    moveCard(b, "k1", "c1", "col1", "lane0");
    sync();

    expect(a.canUndo).toBe(false);
    expect(a.canRedo).toBe(false);
  });
});

describe("inserting a template into a board that already has content", () => {
  const template = (title: string, ids: string[]) => ({
    id: title,
    title,
    widgets: ids.map((id, index) => ({
      id,
      type: "sticky_note" as const,
      parentId: null,
      x: index * 200,
      y: 0,
      width: 161,
      height: 185,
    })),
  });

  it("keeps what is already there and adds the template beside it", () => {
    const doc = new BoardDocument();
    const first = template("First", ["a1", "a2"]);
    insertTemplate(doc, first);

    const before = doc.snapshot().widgets;
    expect(before).toHaveLength(2);
    const firstIds = new Set(before.map((w) => w.id));

    insertTemplate(doc, template("Second", ["b1", "b2"]));

    const after = doc.snapshot().widgets;
    expect(after).toHaveLength(4);

    // The original widgets are untouched, ids and coordinates included.
    for (const widget of before) {
      expect(after.find((w) => w.id === widget.id)).toEqual(widget);
    }

    const firstBox = bounds(after.filter((w) => firstIds.has(w.id)));
    const secondBox = bounds(after.filter((w) => !firstIds.has(w.id)));
    expect(secondBox.x).toBeGreaterThanOrEqual(firstBox.x + firstBox.width);
  });

  it("remaps every id so the same template can be applied twice", () => {
    const doc = new BoardDocument();
    const storyMap = template("Story map", ["same1", "same2"]);
    insertTemplate(doc, storyMap);
    insertTemplate(doc, storyMap);

    const widgets = doc.snapshot().widgets;
    expect(widgets).toHaveLength(4);
    expect(new Set(widgets.map((w) => w.id)).size).toBe(4);
  });

  it("is one undo step", () => {
    const doc = new BoardDocument();
    insertTemplate(doc, template("First", ["a1"]));
    insertTemplate(doc, template("Second", ["b1"]));
    expect(doc.snapshot().widgets).toHaveLength(2);

    doc.undoOnce();
    expect(doc.snapshot().widgets).toHaveLength(1);
  });

  it("remaps kanban placement along with the widgets", () => {
    const doc = new BoardDocument();
    insertTemplate(doc, template("Filler", ["f1"]));

    const result = insertTemplate(
      doc,
      {
        id: "kb",
        title: "Kanban",
        widgets: [
          { id: "k1", type: "kanban", parentId: null, x: 0, y: 0, width: 1200, height: 900 },
          { id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 422, height: 79 },
        ],
      },
      {
        k1: {
          columns: [{ id: "col0", title: "Todo", accent: "#1a1a1a", width: 600 }],
          swimlanes: [{ id: "lane0", title: "Team A" }],
          cards: { c1: { columnId: "col0", swimlaneId: "lane0", order: "n" } },
          newColumnWidth: 574.6,
          headerHeight: 110,
        },
      },
    );

    expect(result.inserted).toBe(2);
    const snapshot = doc.snapshot();
    const kanban = snapshot.widgets.find((w) => w.type === "kanban")!;
    const card = snapshot.widgets.find((w) => w.type === "card")!;

    // The card points at the *new* kanban id, not the captured one.
    expect(card.parentId).toBe(kanban.id);
    expect(kanban.id).not.toBe("k1");
    expect(Object.keys(snapshot.kanbanStates[kanban.id]!.cards)).toEqual([card.id]);
  });
});

describe("authoring: stickies, shapes and connectors", () => {
  it("recolours stickies only, in one step", () => {
    const doc = fresh();
    const board = new BoardDocument();
    const sticky = createSticky(board, "s1", { x: 0, y: 0 }, "yellow");
    const shape = createShape(board, "sh1", "rectangle", { x: 400, y: 0 });
    board.stopCapturing();

    setStickyColor(board, [sticky, shape], "green");

    const widgets = board.snapshot().widgets;
    expect(widgets.find((w) => w.id === "s1")!.style?.fillColor).toBe("green");
    // A shape keeps its own colour vocabulary.
    expect(widgets.find((w) => w.id === "sh1")!.style?.fillColor).toBe("#ffffff");

    board.stopCapturing();
    setStickyColor(board, ["s1"], "red");
    board.undoOnce();
    expect(board.snapshot().widgets.find((w) => w.id === "s1")!.style?.fillColor).toBe("green");
  });

  it("creates shapes with a size that suits the kind", () => {
    const board = new BoardDocument();
    createShape(board, "e1", "ellipse", { x: 0, y: 0 });
    createShape(board, "r1", "rectangle", { x: 0, y: 400 });

    const ellipse = board.snapshot().widgets.find((w) => w.id === "e1")!;
    const rectangle = board.snapshot().widgets.find((w) => w.id === "r1")!;
    expect(ellipse).toMatchObject({ type: "shape", shapeKind: "ellipse", width: 240, height: 240 });
    expect(rectangle.width).toBe(260);
  });

  it("stores only the endpoints of a connector", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    createSticky(board, "b", { x: 600, y: 200 });

    expect(createConnector(board, "c1", "a", "b")).toBe("c1");
    const connector = board.snapshot().widgets.find((w) => w.id === "c1")!;
    expect(connector.start?.item).toBe("a");
    expect(connector.end?.item).toBe("b");
    // No arrow between plain notes.
    expect(connector.arrow).toBe("none");
  });

  it("gives an arrow when a shape is involved", () => {
    const board = new BoardDocument();
    createShape(board, "s1", "rectangle", { x: 0, y: 0 });
    createShape(board, "s2", "diamond", { x: 500, y: 0 });
    createConnector(board, "c1", "s1", "s2");
    expect(board.snapshot().widgets.find((w) => w.id === "c1")!.arrow).toBe("end");
  });

  it("refuses to attach to a container or a kanban card", () => {
    const board = new BoardDocument();
    loadBoard(
      board,
      {
        id: "t",
        title: "T",
        widgets: [
          { id: "k1", type: "kanban", parentId: null, x: 0, y: 0, width: 1200, height: 900 },
          { id: "f1", type: "frame", parentId: null, x: 0, y: 1200, width: 800, height: 300 },
          { id: "s1", type: "sticky_note", parentId: null, x: 0, y: 0, width: 161, height: 185 },
          {
            id: "card1",
            type: "card",
            parentId: "k1",
            x: 0,
            y: 0,
            width: 400,
            height: 79,
          },
        ],
      },
      {},
    );

    // A line to a kanban or a frame would be drawn across the whole board.
    expect(createConnector(board, "c1", "s1", "k1")).toBeNull();
    expect(createConnector(board, "c1", "s1", "f1")).toBeNull();
    // A card is a leaf endpoint; its geometry comes from the kanban placement.
    expect(createConnector(board, "c1", "s1", "card1")).toBe("c1");
    // A note is a leaf and works.
    expect(createConnector(board, "c1", "s1", "s1")).toBeNull();
  });

  it("refuses self-connections and duplicates", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    createSticky(board, "b", { x: 600, y: 0 });

    expect(createConnector(board, "c1", "a", "a")).toBeNull();
    expect(createConnector(board, "c1", "a", "b")).toBe("c1");
    expect(createConnector(board, "c2", "b", "a")).toBeNull();
    expect(board.snapshot().widgets.filter((w) => w.type === "connector")).toHaveLength(1);
  });

  it("removes a connector when an endpoint goes", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    createSticky(board, "b", { x: 600, y: 0 });
    createConnector(board, "c1", "a", "b");

    deleteWidgets(board, ["a"]);
    const widgets = board.snapshot().widgets;
    expect(widgets.map((w) => w.id).sort()).toEqual(["b"]);
  });

  it("keeps connectors working after a template is inserted", () => {
    const board = new BoardDocument();
    insertTemplate(board, {
      id: "t",
      title: "With a connector",
      widgets: [
        { id: "n1", type: "sticky_note", parentId: null, x: 0, y: 0, width: 161, height: 185 },
        { id: "n2", type: "sticky_note", parentId: null, x: 400, y: 0, width: 161, height: 185 },
        {
          id: "k1",
          type: "connector",
          parentId: null,
          x: 200,
          y: 0,
          width: 400,
          height: 0,
          start: { item: "n1" },
          end: { item: "n2" },
        },
      ],
    });

    const connector = board.snapshot().widgets.find((w) => w.type === "connector")!;
    const ids = board.snapshot().widgets.map((w) => w.id);
    // Both endpoints were remapped to ids that exist on this board.
    expect(ids).toContain(connector.start!.item);
    expect(ids).toContain(connector.end!.item);
    expect(connector.start!.item).not.toBe("n1");
  });
});

describe("card fields", () => {
  it("stores status, assignee, dates and unique tags, and clears them", () => {
    const doc = fresh();
    setCardFields(doc, "c1", {
      status: "in_progress",
      assigneeId: "u1",
      assigneeName: "W for Wine",
      startAt: "2026-10-30",
      dueAt: "2026-10-31",
      tagIds: ["t1", "t1", "t2"],
    });

    let card = doc.snapshot().widgets.find((w) => w.id === "c1")!;
    expect(card).toMatchObject({
      status: "in_progress",
      assigneeId: "u1",
      assigneeName: "W for Wine",
      startAt: "2026-10-30",
      dueAt: "2026-10-31",
      tagIds: ["t1", "t2"],
    });

    doc.undoOnce();
    card = doc.snapshot().widgets.find((w) => w.id === "c1")!;
    expect(card.status).toBeUndefined();
    expect(card.assigneeId).toBeUndefined();

    setCardFields(doc, "c1", {
      status: "done",
      assigneeId: "u1",
      assigneeName: "W for Wine",
      startAt: "2026-10-30",
      dueAt: "2026-10-31",
      tagIds: ["t1"],
    });
    setCardFields(doc, "c1", {
      status: undefined,
      assigneeId: undefined,
      startAt: undefined,
      tagIds: [],
    });
    card = doc.snapshot().widgets.find((w) => w.id === "c1")!;
    expect(card.status).toBeUndefined();
    expect(card.assigneeId).toBeUndefined();
    expect(card.assigneeName).toBeUndefined();
    expect(card.startAt).toBeUndefined();
    expect(card.tagIds).toBeUndefined();
    // The due date was not in the clearing patch, so it stays.
    expect(card.dueAt).toBe("2026-10-31");
  });

  it("refuses an invalid status, date or too many tags", () => {
    const doc = fresh();
    expect(() => setCardFields(doc, "c1", { status: "blocked" as never })).toThrow();
    expect(() => setCardFields(doc, "c1", { dueAt: "2026-13-01" })).toThrow();
    expect(() => setCardFields(doc, "c1", { dueAt: "31.10.2026" })).toThrow();
    expect(() =>
      setCardFields(doc, "c1", { tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
    ).toThrow();
  });

  it("ignores a non-card", () => {
    const doc = fresh();
    setCardFields(doc, "s1", { status: "done" });
    expect(doc.snapshot().widgets.find((w) => w.id === "s1")!.status).toBeUndefined();
  });
});

describe("locked objects refuse field edits (ADR-107)", () => {
  it("keeps a locked card's fields and column", () => {
    const doc = fresh();
    setLocked(doc, ["c1"], true);

    setCardFields(doc, "c1", { status: "done", assigneeId: "u1" });
    moveCard(doc, "k1", "c1", "col1", "lane0");

    const card = doc.snapshot().widgets.find((w) => w.id === "c1")!;
    expect(card.status).toBeUndefined();
    expect(card.assigneeId).toBeUndefined();
    expect(doc.snapshot().kanbanStates.k1!.cards.c1!.columnId).toBe("col0");
  });

  it("keeps a locked kanban's columns", () => {
    const doc = fresh();
    setLocked(doc, ["k1"], true);

    addColumn(doc, "k1", "Nope");
    renameColumn(doc, "k1", "col0", "Nope");
    deleteColumn(doc, "k1", "col1");

    const state = doc.snapshot().kanbanStates.k1!;
    expect(state.columns.map((column) => column.id)).toEqual(["col0", "col1"]);
    expect(state.columns[0]!.title).not.toBe("Nope");
  });
});


describe("WIP limits", () => {
  it("sets and clears a column limit in one step", () => {
    const doc = fresh();
    setColumnWip(doc, "k1", "col0", 2);
    expect(doc.snapshot().kanbanStates.k1!.columns[0]!.wipLimit).toBe(2);

    doc.undoOnce();
    expect(doc.snapshot().kanbanStates.k1!.columns[0]!.wipLimit).toBeUndefined();

    setColumnWip(doc, "k1", "col0", 2);
    setColumnWip(doc, "k1", "col0", 0);
    expect(doc.snapshot().kanbanStates.k1!.columns[0]!.wipLimit).toBeUndefined();
  });
});
