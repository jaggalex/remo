import { describe, expect, it } from "vitest";
import { expandGroups, type Widget } from "@remo/model";
import {
  BoardDocument,
  copyFragment,
  createConnector,
  createShape,
  createSticky,
  createWidget,
  deleteWidgets,
  groupNameOf,
  groupWidgets,
  loadBoard,
  pasteFragment,
  setGroupName,
  setWidgetText,
  ungroupWidgets,
} from "./board";
import { setLocked } from "./layers";

const sticky = (id: string, x = 0, y = 0): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width: 100,
  height: 100,
});

const ids = (board: BoardDocument) => board.snapshot().widgets.map((w) => w.id).sort();

describe("groups", () => {
  it("gives the selection one group id and expands any member to the group", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a", 0, 0));
    createWidget(board, sticky("b", 200, 0));

    const groupId = groupWidgets(board, ["a", "b"]);
    expect(groupId).toBeTruthy();
    expect(board.widgets.get("a")!.groupId).toBe(groupId);
    expect(board.widgets.get("b")!.groupId).toBe(groupId);
    expect(expandGroups([...board.widgets.values()], ["a"]).sort()).toEqual(["a", "b"]);
  });

  it("needs two members and ignores cards and connectors", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a"));
    createWidget(board, {
      id: "k1",
      type: "kanban",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    createWidget(board, {
      id: "c1",
      type: "card",
      parentId: "k1",
      x: 0,
      y: 0,
      width: 400,
      height: 80,
    });
    createShape(board, "s1", "rectangle", { x: 500, y: 0 });
    createConnector(board, "line", "a", "s1");

    expect(groupWidgets(board, ["a"])).toBeNull();
    expect(groupWidgets(board, ["a", "c1"])).toBeNull();
    expect(groupWidgets(board, ["a", "line"])).toBeNull();
    expect(groupWidgets(board, ["a", "s1"])).toBeTruthy();
    expect(board.widgets.get("c1")!.groupId).toBeUndefined();
    expect(board.widgets.get("line")!.groupId).toBeUndefined();
  });

  it("does not regroup a selection that is already exactly one group", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a"));
    createWidget(board, sticky("b"));
    const first = groupWidgets(board, ["a", "b"]);
    expect(groupWidgets(board, ["a", "b"])).toBe(first);
  });

  it("groups the frame, not the child that is already inside it", () => {
    const board = new BoardDocument();
    createWidget(board, {
      id: "f1",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    createWidget(board, { ...sticky("a"), parentId: "f1" });
    createWidget(board, sticky("b", 700, 0));

    expect(groupWidgets(board, ["f1", "a", "b"])).toBeTruthy();
    expect(board.widgets.get("f1")!.groupId).toBeTruthy();
    expect(board.widgets.get("b")!.groupId).toBe(board.widgets.get("f1")!.groupId);
    // The child follows its frame; giving it its own membership would make a click
    // on it select a different group from the frame it belongs to.
    expect(board.widgets.get("a")!.groupId).toBeUndefined();
  });

  it("dissolves the whole group when any member is ungrouped", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a"));
    createWidget(board, sticky("b"));
    createWidget(board, sticky("c"));
    createWidget(board, sticky("d"));
    const first = groupWidgets(board, ["a", "b"]);
    const second = groupWidgets(board, ["c", "d"]);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    ungroupWidgets(board, ["b"]);
    expect(board.widgets.get("a")!.groupId).toBeUndefined();
    expect(board.widgets.get("b")!.groupId).toBeUndefined();
    // A different group is untouched.
    expect(board.widgets.get("c")!.groupId).toBe(second);
    expect(board.widgets.get("d")!.groupId).toBe(second);
  });

  it("deletes a whole group when one member is deleted", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a"));
    createWidget(board, sticky("b"));
    createWidget(board, sticky("c"));
    groupWidgets(board, ["a", "b"]);

    deleteWidgets(board, ["a"]);
    expect(ids(board)).toEqual(["c"]);
  });
});

describe("clipboard fragments", () => {
  it("copies a group as one new group, offset and selected", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a", 0, 0));
    createWidget(board, sticky("b", 200, 0));
    groupWidgets(board, ["a", "b"]);
    setWidgetText(board, "a", "hello");

    const fragment = copyFragment(board, ["a"])!;
    // Copying one member copies the whole group.
    expect(fragment.roots.sort()).toEqual(["a", "b"]);
    expect(fragment.texts.a!.delta).toEqual([{ insert: "hello" }]);

    const pasted = pasteFragment(board, fragment);
    expect(pasted).toHaveLength(2);
    expect(pasted).not.toContain("a");
    const widgets = board.snapshot().widgets;
    const copies = widgets.filter((w) => pasted.includes(w.id));
    expect(copies.map((w) => w.x).sort((x, y) => x - y)).toEqual([24, 224]);
    expect(new Set(copies.map((w) => w.groupId)).size).toBe(1);
    expect(copies[0]!.groupId).not.toBe(board.widgets.get("a")!.groupId);
    expect(copies.some((w) => w.content === "hello")).toBe(true);
    expect(expandGroups(widgets, [pasted[0]!]).sort()).toEqual([...pasted].sort());
  });

  it("copies a frame with its contents and remaps the parent link", () => {
    const board = new BoardDocument();
    createWidget(board, {
      id: "f1",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    createWidget(board, { ...sticky("a", 10, 10), parentId: "f1" });

    const pasted = pasteFragment(board, copyFragment(board, ["f1"])!);
    expect(pasted).toHaveLength(1);
    const frame = board.widgets.get(pasted[0]!)!;
    const children = [...board.widgets.values()].filter((w) => w.parentId === frame.id);
    expect(children).toHaveLength(1);
    expect(children[0]!.x).toBe(34);
  });

  it("keeps a connector only when both ends came along", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a"));
    createWidget(board, sticky("b", 300, 0));
    createWidget(board, sticky("c", 600, 0));
    createConnector(board, "ab", "a", "b");
    createConnector(board, "bc", "b", "c");

    const fragment = copyFragment(board, ["a", "b"])!;
    expect(fragment.widgets.map((w) => w.id).sort()).toEqual(["a", "ab", "b"]);

    const pasted = pasteFragment(board, fragment);
    const connector = [...board.widgets.values()].find(
      (w) => w.type === "connector" && w.id !== "ab" && w.id !== "bc",
    )!;
    const from = board.widgets.get(connector.start!.item!)!;
    const to = board.widgets.get(connector.end!.item!)!;
    expect(pasted).toContain(from.id);
    expect(pasted).toContain(to.id);
    expect(from.type).toBe("sticky_note");
    expect(to.type).toBe("sticky_note");
    expect(connector.start!.item).not.toBe("a");
  });

  it("copies a kanban with its matrix and cards, remapping every card", () => {
    const board = new BoardDocument();
    loadBoard(board, {
      id: "t",
      title: "T",
      widgets: [
        { id: "k1", type: "kanban", parentId: null, x: 0, y: 0, width: 600, height: 400 },
        { id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 400, height: 80, title: "one" },
      ],
    }, {
      k1: {
        columns: [{ id: "col0", title: "Todo", accent: "#000", width: 600 }],
        swimlanes: [{ id: "lane0", title: "A" }],
        cards: { c1: { columnId: "col0", swimlaneId: "lane0", order: "n" } },
        newColumnWidth: 600,
        headerHeight: 110,
      },
    });

    const pasted = pasteFragment(board, copyFragment(board, ["k1"])!);
    expect(pasted).toHaveLength(1);
    const copyId = pasted[0]!;
    const state = board.snapshot().kanbanStates[copyId]!;
    expect(state.columns.map((c) => c.title)).toEqual(["Todo"]);
    const cardIds = Object.keys(state.cards);
    expect(cardIds).toHaveLength(1);
    expect(cardIds[0]).not.toBe("c1");
    expect(board.widgets.get(cardIds[0]!)!.title).toBe("one");
  });

  it("appends a card copied on its own to the end of its cell", () => {
    const board = new BoardDocument();
    loadBoard(board, {
      id: "t",
      title: "T",
      widgets: [
        { id: "k1", type: "kanban", parentId: null, x: 0, y: 0, width: 600, height: 400 },
        { id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 400, height: 80, title: "one" },
      ],
    }, {
      k1: {
        columns: [{ id: "col0", title: "Todo", accent: "#000", width: 600 }],
        swimlanes: [{ id: "lane0", title: "A" }],
        cards: { c1: { columnId: "col0", swimlaneId: "lane0", order: "n" } },
        newColumnWidth: 600,
        headerHeight: 110,
      },
    });

    const fragment = copyFragment(board, ["c1"])!;
    const pasted = pasteFragment(board, fragment);
    expect(pasted).toHaveLength(1);
    const state = board.snapshot().kanbanStates.k1!;
    expect(Object.keys(state.cards)).toHaveLength(2);
    expect(state.cards[pasted[0]!]).toMatchObject({ columnId: "col0", swimlaneId: "lane0" });
    expect(state.cards[pasted[0]!]!.order > "n").toBe(true);
    expect(board.widgets.get(pasted[0]!)!.title).toBe("one");
  });

  it("drops a card pasted into a board without its kanban", () => {
    const source = new BoardDocument();
    loadBoard(source, {
      id: "t",
      title: "T",
      widgets: [
        { id: "k1", type: "kanban", parentId: null, x: 0, y: 0, width: 600, height: 400 },
        { id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 400, height: 80, title: "one" },
      ],
    }, {
      k1: {
        columns: [{ id: "col0", title: "Todo", accent: "#000", width: 600 }],
        swimlanes: [{ id: "lane0", title: "A" }],
        cards: { c1: { columnId: "col0", swimlaneId: "lane0", order: "n" } },
        newColumnWidth: 600,
        headerHeight: 110,
      },
    });

    const fragment = copyFragment(source, ["c1"])!;
    const target = new BoardDocument();
    createWidget(target, sticky("x"));
    expect(pasteFragment(target, fragment)).toEqual([]);
    expect(ids(target)).toEqual(["x"]);
  });

  it("pastes as exactly one undo step", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a"));
    createWidget(board, sticky("b", 300, 0));
    const fragment = copyFragment(board, ["a", "b"])!;
    const before = board.widgets.size;

    pasteFragment(board, fragment);
    expect(board.widgets.size).toBe(before + 2);

    board.undoOnce();
    expect(board.widgets.size).toBe(before);
  });
});

describe("group names", () => {
  it("survives adding a member and disappears when the group dissolves", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a", 0, 0));
    createWidget(board, sticky("b", 200, 0));
    createWidget(board, sticky("c", 400, 0));

    const groupId = groupWidgets(board, ["a", "b"])!;
    setGroupName(board, groupId, "  Onboarding  ");
    expect(groupNameOf(board, groupId)).toBe("Onboarding");

    // Adding a member reuses the cluster id, so the label follows.
    expect(groupWidgets(board, ["a", "b", "c"])).toBe(groupId);
    expect(groupNameOf(board, groupId)).toBe("Onboarding");

    ungroupWidgets(board, ["b"]);
    expect(groupNameOf(board, groupId)).toBe("");
  });

  it("is removed with the last member and restored by undo", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a", 0, 0));
    createWidget(board, sticky("b", 200, 0));
    const groupId = groupWidgets(board, ["a", "b"])!;
    setGroupName(board, groupId, "Pricing");

    deleteWidgets(board, ["a"]);
    expect(board.widgets.has("a")).toBe(false);
    expect(groupNameOf(board, groupId)).toBe("");

    board.undoOnce();
    expect(board.widgets.has("a")).toBe(true);
    expect(groupNameOf(board, groupId)).toBe("Pricing");
  });

  it("travels with a copied group under its new id", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a", 0, 0));
    createWidget(board, sticky("b", 200, 0));
    const groupId = groupWidgets(board, ["a", "b"])!;
    setGroupName(board, groupId, "Research");

    const fragment = copyFragment(board, ["a", "b"])!;
    const pasted = pasteFragment(board, fragment);
    const copyGroup = board.widgets.get(pasted[0]!)?.groupId;
    expect(copyGroup).toBeTruthy();
    expect(copyGroup).not.toBe(groupId);
    expect(groupNameOf(board, copyGroup!)).toBe("Research");
  });
});

describe("a copy is never locked (ADR-107)", () => {
  it("drops the lock and its author from pasted objects", () => {
    const board = new BoardDocument();
    createWidget(board, sticky("a", 0, 0));
    setLocked(board, ["a"], true, { id: "u1", name: "Ann" });
    expect(board.widgets.get("a")!.lockedBy).toBe("u1");

    const pasted = pasteFragment(board, copyFragment(board, ["a"])!);
    const copy = board.widgets.get(pasted[0]!)!;
    expect(copy.locked).toBeUndefined();
    expect(copy.lockedBy).toBeUndefined();
    expect(copy.lockedByName).toBeUndefined();
    expect(copy.lockedAt).toBeUndefined();
    // The source keeps its lock: a copy does not release the original.
    expect(board.widgets.get("a")!.locked).toBe(true);
  });
});
