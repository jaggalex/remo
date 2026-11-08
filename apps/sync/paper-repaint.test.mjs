import { describe, expect, it } from "vitest";
import { FILL_LEVELS, PREVIOUS_FILL_LEVELS, TONES, TONE_LEVELS } from "../../packages/model/src/colorLevels.ts";
import { BOARD_COLORS } from "../../packages/model/src/palette.ts";
import { PAPER_REPAINT, paperFor, repaintDocument } from "./paper-repaint.mjs";
// The same Yjs instance the module uses (see project.test.mjs).
import { Y } from "./y.mjs";

function room({ widgets = [], accents = [] } = {}) {
  const doc = new Y.Doc();
  const map = doc.getMap("widgets");
  for (const widget of widgets) map.set(widget.id, widget);
  if (accents.length) {
    const kanban = new Y.Map();
    doc.getMap("kanbans").set("k1", kanban);
    const columns = new Y.Array();
    kanban.set("columns", columns);
    columns.push(
      accents.map((accent, index) => {
        const column = new Y.Map();
        column.set("id", `c${index}`);
        column.set("accent", accent);
        return column;
      }),
    );
  }
  return doc;
}

describe("the paper repaint (ADR-183)", () => {
  it("is the model's previous → current table, pair for pair", () => {
    const expected = {};
    for (const tone of TONES) {
      for (const level of FILL_LEVELS) expected[PREVIOUS_FILL_LEVELS[tone][level]] = TONE_LEVELS[tone][level];
    }
    expect({ ...PAPER_REPAINT }).toEqual(expected);
  });

  it("leaves the 22 colours of ADR-120 and anything else alone", () => {
    for (const legacy of BOARD_COLORS) expect(paperFor(legacy)).toBeNull();
    expect(paperFor("#ffffff")).toBeNull();
    expect(paperFor("transparent")).toBeNull();
    expect(paperFor(undefined)).toBeNull();
    expect(paperFor(" #FFE07A ")).toBe("#ece2c8");
  });

  it("counts without changing anything unless asked to apply", () => {
    const doc = room({
      widgets: [
        { id: "a", type: "sticky_note", style: { fillColor: "#ffe07a" } },
        { id: "b", type: "shape", style: { fillColor: "#ffffff", strokeColor: "#bfb9b1" } },
        { id: "c", type: "sticky_note", style: { fillColor: "#f8d3af" } },
        { id: "d", type: "text" },
      ],
      accents: ["#f2b94a", "#9ca3af"],
    });
    const before = Y.encodeStateAsUpdate(doc);
    expect(repaintDocument(doc)).toEqual({
      widgets: 2,
      columns: 1,
      fills: [{ id: "a", from: "#ffe07a", to: "#ece2c8" }],
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("rewrites colours in one transaction and keeps every other field", () => {
    const doc = room({
      widgets: [
        { id: "a", type: "sticky_note", x: 4, locked: true, style: { fillColor: "#FF8A57", stickySize: "M" } },
        { id: "l", type: "connector", style: { strokeColor: "#bfb9b1", strokeStyle: "dashed" } },
      ],
      accents: ["#85d965"],
    });
    let transactions = 0;
    doc.on("afterTransaction", () => (transactions += 1));
    repaintDocument(doc, { apply: true });
    expect(transactions).toBe(1);
    expect(doc.getMap("widgets").get("a")).toEqual({
      id: "a",
      type: "sticky_note",
      x: 4,
      locked: true,
      style: { fillColor: "#bca996", stickySize: "M" },
    });
    expect(doc.getMap("widgets").get("l").style).toEqual({ strokeColor: "#cdc8c0", strokeStyle: "dashed" });
    const column = doc.getMap("kanbans").get("k1").get("columns").get(0);
    expect(column.get("accent")).toBe("#bcbfa9");
    // Idempotent: a second run has nothing to do.
    expect(repaintDocument(doc, { apply: true })).toEqual({ widgets: 0, columns: 0, fills: [] });
  });
});
