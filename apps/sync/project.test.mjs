import { describe, expect, it } from "vitest";
// `project.mjs` resolves Yjs through ./y.mjs (the CJS build the y-websocket server
// utilities use), so the test builds documents with that same instance — importing
// the ESM build as well would load a second copy of the library.
import { Y as Yjs } from "./y.mjs";

/** Build a document shaped like the app's board document. */
function boardDoc({ widgets = [], columns = [], swimlanes = [], cards = {}, texts = {}, title = "" } = {}) {
  const doc = new Yjs.Doc();
  const widgetMap = doc.getMap("widgets");
  for (const widget of widgets) widgetMap.set(widget.id, widget);

  const kanban = new Yjs.Map();
  const columnArray = new Yjs.Array();
  for (const column of columns) {
    const entry = new Yjs.Map();
    for (const [key, value] of Object.entries(column)) entry.set(key, value);
    columnArray.push([entry]);
  }
  const swimlaneArray = new Yjs.Array();
  for (const lane of swimlanes) {
    const entry = new Yjs.Map();
    for (const [key, value] of Object.entries(lane)) entry.set(key, value);
    swimlaneArray.push([entry]);
  }
  const cardMap = new Yjs.Map();
  for (const [cardId, placement] of Object.entries(cards)) {
    const entry = new Yjs.Map();
    for (const [key, value] of Object.entries(placement)) entry.set(key, value);
    cardMap.set(cardId, entry);
  }
  const textMap = doc.getMap("texts");
  for (const [id, value] of Object.entries(texts)) {
    const shared = new Yjs.Text();
    shared.insert(0, value);
    textMap.set(id, shared);
  }

  if (title) doc.getMap("meta").set("title", title);

  kanban.set("columns", columnArray);
  kanban.set("swimlanes", swimlaneArray);
  kanban.set("cards", cardMap);
  doc.getMap("kanbans").set("k1", kanban);
  return doc;
}

const { projectBoard, projectKanban, diffRows } = await import("./project.mjs");

describe("board projection", () => {
  it("skips kanban values it cannot read instead of throwing", () => {
    const doc = new Yjs.Doc();
    const kanbans = doc.getMap("kanbans");
    kanbans.set("number", 1);
    kanbans.set("text", "plain");
    const kanban = new Yjs.Map();
    kanbans.set("mixed", kanban);
    const columns = new Yjs.Array();
    columns.push(["not a map", 7]);
    kanban.set("columns", columns);
    const cards = new Yjs.Map();
    cards.set("card", "not a map");
    kanban.set("cards", cards);

    expect(projectKanban(doc)).toEqual({ columns: [], swimlanes: [], cards: [] });
  });

  it("projects table axes and cell membership into props", () => {
    const doc = boardDoc({
      widgets: [
        {
          id: "table",
          type: "frame",
          parentId: null,
          x: 0,
          y: 0,
          width: 600,
          height: 400,
          layout: {
            kind: "table",
            active: true,
            columns: [
              { id: "c1", title: "Now" },
              { id: "c2", title: "Next" },
            ],
            rows: [{ id: "r1", title: "Step" }],
          },
        },
        {
          id: "note",
          type: "sticky_note",
          parentId: "table",
          x: 0,
          y: 0,
          width: 160,
          height: 180,
          cell: { rowId: "r1", columnId: "c2" },
        },
      ],
    });
    const { widgets } = projectBoard(doc);
    const frame = widgets.find((row) => row.id === "table");
    const note = widgets.find((row) => row.id === "note");
    expect(frame.props.table).toEqual({
      active: true,
      columns: [
        { id: "c1", title: "Now" },
        { id: "c2", title: "Next" },
      ],
      rows: [{ id: "r1", title: "Step" }],
    });
    expect(note.props.cell).toEqual({ rowId: "r1", columnId: "c2" });
  });

  it("flattens widgets with their style colours", () => {
    const doc = boardDoc({
      widgets: [
        {
          id: "w1",
          type: "sticky_note",
          parentId: null,
          x: 10,
          y: 20,
          width: 161,
          height: 184,
          style: { fillColor: "yellow" },
        },
        { id: "w2", type: "card", parentId: "k1", x: 0, y: 0, width: 422, height: 79, title: "one" },
      ],
    });

    const { widgets } = projectBoard(doc);
    expect(widgets.map((row) => row.id)).toEqual(["w1", "w2"]);
    expect(widgets[0]).toMatchObject({ type: "sticky_note", fillColor: "yellow", rotation: 0 });
    expect(widgets[1]).toMatchObject({ parentId: "k1", title: "one" });
  });

  it("keeps the kanban matrix: columns, swimlanes and card placement", () => {
    const doc = boardDoc({
      widgets: [{ id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 422, height: 79 }],
      columns: [
        { id: "col0", title: "Todo", accent: "#1a1a1a", width: 492 },
        { id: "col1", title: "Doing", accent: "#ffdd33", width: 492 },
      ],
      swimlanes: [{ id: "lane0", title: "Team A" }],
      cards: { c1: { columnId: "col1", swimlaneId: "lane0", order: "n" } },
    });

    const { kanban } = projectBoard(doc);
    expect(kanban.columns.map((row) => [row.title, row.position])).toEqual([
      ["Todo", 0],
      ["Doing", 1],
    ]);
    expect(kanban.swimlanes).toHaveLength(1);
    expect(kanban.cards).toEqual([
      { kanbanId: "k1", cardId: "c1", columnId: "col1", swimlaneId: "lane0", orderKey: "n" },
    ]);
  });

  it("keeps modelled extras in props", () => {
    const doc = boardDoc({
      widgets: [
        {
          id: "s1",
          type: "stamp",
          parentId: null,
          x: 0,
          y: 0,
          width: 177,
          height: 177,
          name: "Intro",
          label: "Hot!",
        },
        {
          id: "sh1",
          type: "shape",
          parentId: null,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          shapeKind: "diamond",
        },
        { id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 422, height: 79 },
      ],
    });

    const { widgets } = projectBoard(doc);
    expect(widgets.find((row) => row.id === "s1").props).toEqual({
      name: "Intro",
      label: "Hot!",
    });
    expect(widgets.find((row) => row.id === "sh1").props).toEqual({ shapeKind: "diamond" });
    // A plain card has nothing modelled about it, so the column stays null.
    expect(widgets.find((row) => row.id === "c1").props).toBeNull();
  });

  it("records what a connector joins", () => {
    const doc = boardDoc({
      widgets: [
        { id: "n1", type: "sticky_note", parentId: null, x: 0, y: 0, width: 161, height: 185 },
        { id: "sh1", type: "shape", parentId: null, x: 600, y: 0, width: 240, height: 240, shapeKind: "ellipse" },
        {
          id: "c1",
          type: "connector",
          parentId: null,
          x: 300,
          y: 0,
          width: 600,
          height: 0,
          start: { item: "n1" },
          end: { item: "sh1" },
          arrow: "end",
        },
      ],
    });

    const { widgets } = projectBoard(doc);
    expect(widgets.find((row) => row.id === "c1").props).toEqual({
      startItem: "n1",
      endItem: "sh1",
      arrow: "end",
    });
    expect(widgets.find((row) => row.id === "sh1").props).toEqual({ shapeKind: "ellipse" });
  });

  it("tolerates a document with no kanban at all", () => {
    const doc = new Yjs.Doc();
    expect(projectBoard(doc)).toEqual({
      title: "",
      widgets: [],
      kanban: { columns: [], swimlanes: [], cards: [] },
    });
  });
});

describe("projection diff", () => {
  const key = (row) => row.id;
  const rows = (...ids) => ids.map((id) => ({ id, value: 1 }));

  it("separates inserts, updates and deletes", () => {
    const before = rows("a", "b", "c");
    const after = [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "d", value: 1 }];
    const diff = diffRows(before, after, key);

    expect(diff.inserted.map(key)).toEqual(["d"]);
    expect(diff.updated.map(key)).toEqual(["b"]);
    expect(diff.removed.map(key)).toEqual(["c"]);
  });

  it("reports nothing when the projection is unchanged", () => {
    const before = rows("a", "b");
    const diff = diffRows(before, rows("a", "b"), key);
    expect(diff).toEqual({ inserted: [], updated: [], removed: [] });
  });
});

describe("shared text", () => {
  it("projects the shared text over the imported title", () => {
    const doc = boardDoc({
      widgets: [
        { id: "c1", type: "card", parentId: "k1", x: 0, y: 0, width: 422, height: 79, title: "old" },
        { id: "s1", type: "sticky_note", parentId: null, x: 0, y: 0, width: 161, height: 184, content: "template text" },
      ],
      texts: { c1: "typed by a human" },
    });

    const { widgets } = projectBoard(doc);
    expect(widgets.find((row) => row.id === "c1").title).toBe("typed by a human");
    expect(widgets.find((row) => row.id === "s1").content).toBe("template text");
    // A sticky keeps its title column empty; its text is the content column.
    expect(widgets.find((row) => row.id === "s1").title).toBeNull();
  });
});

describe("board meta", () => {
  it("carries the title from the document", () => {
    const doc = boardDoc({ title: "Sprint 12" });
    expect(projectBoard(doc).title).toBe("Sprint 12");
  });
});
