import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { buildBoardBackup, verifyBoardBackup } from "./backup.mjs";

function fixture() {
  const doc = new Y.Doc();
  const widgets = doc.getMap("widgets");
  const note = new Y.Map();
  note.set("id", "note-1");
  note.set("type", "sticky_note");
  note.set("x", 10);
  note.set("y", 20);
  widgets.set("note-1", note);
  const connector = new Y.Map();
  connector.set("id", "line-1");
  connector.set("type", "connector");
  connector.set("routing", "elbow");
  connector.set("waypoints", [{ id: "p1", x: 30, y: 40, rigid: true }]);
  connector.set("start", { item: "note-1" });
  connector.set("end", { item: "other" });
  widgets.set("line-1", connector);
  const texts = doc.getMap("texts");
  const text = new Y.Text();
  text.insert(0, "hello");
  texts.set("note-1", text);
  doc.getMap("groupNames").set("grp-1", "Cluster");
  doc.getMap("tags").set("tag-1", { id: "tag-1", name: "Priority", color: "blue" });
  doc.getArray("presentation").push(["frame-1"]);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

function tableState() {
  const doc = new Y.Doc();
  const widgets = doc.getMap("widgets");
  const frame = new Y.Map();
  frame.set("id", "frame-1");
  frame.set("type", "frame");
  frame.set("x", 0);
  frame.set("y", 0);
  frame.set("width", 600);
  frame.set("height", 400);
  frame.set("layout", {
    kind: "table",
    columns: [
      { id: "col-1", title: "Now", size: "wide" },
      { id: "col-2", title: "Next" },
    ],
    rows: [{ id: "row-1", title: "Step" }],
    appearance: { headers: "#f3f1ec", cells: { "row-1:col-2": "#d8c79e" } },
  });
  widgets.set("frame-1", frame);
  const note = new Y.Map();
  note.set("id", "note-1");
  note.set("type", "sticky_note");
  note.set("parentId", "frame-1");
  note.set("x", 10);
  note.set("y", 20);
  note.set("cell", { rowId: "row-1", columnId: "col-1" });
  widgets.set("note-1", note);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

describe("board backup (ADR-071)", () => {
  it("is plain JSON with a verifiable checksum and connector waypoints", () => {
    const backup = buildBoardBackup({
      state: fixture(),
      boardId: "board-1",
      title: "Backup test",
    });
    expect(backup.manifest.format).toBe("remo.board.backup");
    expect(backup.manifest.boardId).toBe("board-1");
    expect(backup.manifest.counts).toMatchObject({ widgets: 2, connectors: 1 });
    expect(backup.widgets["line-1"].routing).toBe("elbow");
    expect(backup.widgets["line-1"].waypoints).toEqual([
      { id: "p1", x: 30, y: 40, rigid: true },
    ]);
    expect(backup.texts["note-1"]).toBe("hello");
    expect(backup.textDeltas["note-1"]).toEqual([{ insert: "hello" }]);
    expect(backup.groupNames["grp-1"]).toBe("Cluster");
    expect(backup.tags["tag-1"]).toMatchObject({ name: "Priority", color: "blue" });
    expect(backup.presentation).toEqual(["frame-1"]);
    expect(backup.manifest.version).toBe(2);
    expect(verifyBoardBackup(JSON.parse(JSON.stringify(backup)))).toBe(true);
  });

  it("carries the table layout and cell membership", () => {
    const backup = buildBoardBackup({ state: tableState(), boardId: "board-1" });
    expect(backup.widgets["frame-1"].layout).toMatchObject({
      kind: "table",
      columns: [
        { id: "col-1", title: "Now", size: "wide" },
        { id: "col-2", title: "Next" },
      ],
      rows: [{ id: "row-1", title: "Step" }],
      appearance: { headers: "#f3f1ec", cells: { "row-1:col-2": "#d8c79e" } },
    });
    expect(backup.widgets["note-1"].cell).toEqual({
      rowId: "row-1",
      columnId: "col-1",
    });
    expect(verifyBoardBackup(JSON.parse(JSON.stringify(backup)))).toBe(true);
  });

  it("detects a changed bundle", () => {
    const backup = buildBoardBackup({ state: fixture(), boardId: "board-1" });
    const changed = structuredClone(backup);
    changed.widgets["note-1"].x = 999;
    expect(verifyBoardBackup(changed)).toBe(false);
  });
});
