import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildSelectionSource, expandSelection, tidyGroups } from "./selection-source.mjs";

/**
 * The selection is source (ADR-143). These tests pin the two expansions a person
 * cannot see in the UI — a group means its members, a frame means its contents — the
 * reading order and the two limits. The fixture is a plain Y.Doc, no database.
 */

function board(widgets) {
  const doc = new Y.Doc();
  const map = doc.getMap("widgets");
  for (const widget of widgets) map.set(widget.id, widget);
  return doc;
}

function note(id, x, y, text, extra = {}) {
  return {
    id,
    type: "sticky_note",
    parentId: null,
    x,
    y,
    width: 160,
    height: 180,
    content: text,
    ...extra,
  };
}

describe("selection as source", () => {
  const doc = board([
    note("n2", 200, 300, "US-2: cart"),
    note("n10", 0, 100, "US-10: refund"),
    note("n1", 400, 100, "US-1: browse"),
    note("empty", 0, 0, ""),
    note("dup", 0, 500, "US-1: browse"),
    note("g1", 600, 600, "Group A", { groupId: "g" }),
    note("g2", 800, 600, "Group B", { groupId: "g" }),
    {
      id: "frame",
      type: "frame",
      parentId: null,
      x: 0,
      y: 1000,
      width: 600,
      height: 400,
      title: "Lane",
    },
    note("f1", -100, 950, "Inside one", { parentId: "frame" }),
    note("f2", 100, 1050, "Inside two", { parentId: "frame" }),
    note("stray", 0, 1400, "Not selected", { parentId: "unselected-frame" }),
    {
      id: "line",
      type: "connector",
      parentId: null,
      x: 100,
      y: 200,
      width: 100,
      height: 100,
      start: { item: "n1" },
      end: { item: "n2" },
    },
  ]);

  it("expands a group and a frame, deduplicates and reads top-down", () => {
    const expanded = expandSelection(doc, ["g1", "frame", "dup", "n10"]);
    const ids = expanded.objects.map((object) => object.id);
    // n10 (100), frame contents (950/1050), group members (600), dup (500)…
    expect(ids).toEqual(["n10", "dup", "g1", "g2", "f1", "frame", "f2"]);
    expect(expanded.frames).toEqual(["frame"]);
    expect(expanded.groups).toEqual(["g"]);
    // The line joins n1 and n2, neither of which is in this selection.
    expect(expanded.connectors).toEqual([]);
  });

  it("keeps a connector only when both ends are selected", () => {
    const source = buildSelectionSource(doc, ["n1", "n2", "n10"]);
    expect(source.connectors).toEqual([{ id: "line", from: "n1", to: "n2" }]);
    expect(source.texts).toEqual(["US-10: refund", "US-1: browse", "US-2: cart"]);
  });

  it("drops empty and repeated texts", () => {
    const source = buildSelectionSource(doc, ["n1", "dup", "empty"]);
    expect(source.texts).toEqual(["US-1: browse"]);
    expect(source.counts.empty).toBe(1);
    expect(source.counts.duplicates).toBe(1);
  });

  it("stops at fifty objects and says so", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      note(`m${index}`, index * 10, 0, `Note ${index}`),
    );
    const source = buildSelectionSource(board(many), many.map((item) => item.id));
    expect(source.counts.included).toBe(50);
    expect(source.truncated).toBe(true);
    expect(source.truncationCode).toBe("SELECTION_TRUNCATED");
  });

  it("carries table axes and cell membership", () => {
    const table = {
      id: "table",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      title: "Plan",
      layout: {
        kind: "table",
        active: true,
        columns: [
          { id: "c1", title: "Now" },
          { id: "c2", title: "Next" },
        ],
        rows: [{ id: "r1", title: "Step" }],
      },
    };
    const inside = note("cell-note", 0, 0, "Inside", {
      parentId: "table",
      cell: { rowId: "r1", columnId: "c2" },
    });
    const source = buildSelectionSource(board([table, inside]), ["table"]);
    const frame = source.objects.find((object) => object.id === "table");
    const child = source.objects.find((object) => object.id === "cell-note");
    expect(frame.table).toEqual({
      active: true,
      columns: [
        { id: "c1", title: "Now" },
        { id: "c2", title: "Next" },
      ],
      rows: [{ id: "r1", title: "Step" }],
    });
    expect(child.cell).toEqual({ rowId: "r1", columnId: "c2" });
  });

  it("cuts a long text at a boundary and reports it", () => {
    const words = Array.from({ length: 4_000 }, (_, index) => `word${index}`).join(" ");
    const source = buildSelectionSource(board([note("long", 0, 0, words)]), ["long"]);
    expect(source.counts.chars).toBeLessThanOrEqual(20_000);
    expect(source.truncated).toBe(true);
    expect(source.texts[0].length).toBeLessThan(words.length);
  });
});

describe("tidy groups", () => {
  it("lays a selected frame out inside itself and leaves a stranger alone", () => {
    const doc = board([
      {
        id: "frame",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        title: "Lane",
      },
      note("a", -200, -100, "US-1", { parentId: "frame" }),
      note("b", 200, 100, "US-2", { parentId: "frame", locked: true }),
      note("outside", 0, 1000, "Outside"),
      note("other", 0, 1500, "Other frame", { parentId: "unselected" }),
    ]);

    const facts = tidyGroups(doc, ["frame", "other"]);
    expect(facts.groups).toHaveLength(1);
    const group = facts.groups[0];
    expect(group.kind).toBe("frame");
    expect(group.frameId).toBe("frame");
    expect(group.items.map((item) => item.id).sort()).toEqual(["a", "b"]);
    expect(group.area).toMatchObject({ x: -376, y: -256, width: 752, height: 532 });
    // The object inside a frame nobody selected is not detached from it.
    expect(facts.skipped).toEqual(["other"]);
    expect(facts.foreign.some((box) => box.id === "outside")).toBe(true);
  });

  it("tidies selected children inside an unselected frame, instead of refusing", () => {
    const doc = board([
      {
        id: "frame",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 900,
        height: 700,
        title: "Lane",
      },
      note("a", -200, -100, "US-1", { parentId: "frame" }),
      note("b", 200, 100, "US-2", { parentId: "frame" }),
      note("stranger", 0, 0, "Not selected", { parentId: "frame" }),
    ]);

    // A marquee that started inside a frame selects its children, not the frame.
    const facts = tidyGroups(doc, ["a", "b"]);
    expect(facts.groups).toHaveLength(1);
    expect(facts.groups[0].frameId).toBe("frame");
    expect(facts.groups[0].items.map((item) => item.id).sort()).toEqual(["a", "b"]);
    // The third child stays exactly where it is.
    expect(facts.groups[0].items.map((item) => item.id).sort()).toEqual(["a", "b"]);
    expect(facts.foreign.some((box) => box.id === "stranger")).toBe(true);
  });

  it("keeps a free selection together and treats the frame as an obstacle", () => {
    const doc = board([
      { id: "frame", type: "frame", parentId: null, x: 0, y: 0, width: 400, height: 300 },
      note("a", 100, 600, "one"),
      note("b", 300, 600, "two"),
    ]);
    const facts = tidyGroups(doc, ["a", "b"]);
    expect(facts.groups).toHaveLength(1);
    expect(facts.groups[0].kind).toBe("free");
    expect(facts.groups[0].items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(facts.foreign.some((box) => box.id === "frame")).toBe(true);
  });
});
