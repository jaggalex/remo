import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_SIZE, kindOf, minimumSizeOf, WIDGET_KINDS } from "./kinds";
import { layerKey, paintOrder } from "./layers";
import { canConnect, type Widget, type WidgetType } from "./types";

/**
 * The capability table is the single answer to "can this kind do X".
 *
 * These tests exist to make the migration safe: they pin the behaviour every module
 * used to compute for itself, so moving a check onto the table cannot change what the
 * board does by accident (ADR-049).
 */

const kinds = Object.keys(WIDGET_KINDS) as WidgetType[];

const widget = (type: WidgetType): Widget => ({
  id: `${type}-1`,
  type,
  parentId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

describe("the capability table", () => {
  it("answers for every kind of widget", () => {
    expect([...kinds].sort()).toEqual(
      ["card", "connector", "frame", "group", "image", "kanban", "shape", "stamp", "sticky_note", "text", "timer", "unsupported"],
    );
  });

  it("keeps the paint order the templates rely on", () => {
    expect(kinds.map((type) => [type, kindOf(type).rank])).toEqual([
      ["frame", 0],
      ["kanban", 1],
      ["shape", 2],
      ["image", 2],
      ["unsupported", 2],
      ["connector", 3],
      ["group", 5],
      ["timer", 7],
      ["stamp", 4],
      ["sticky_note", 5],
      ["card", 6],
      ["text", 9],
    ]);
  });

  it("tags text-holding kinds exactly as the document used to", () => {
    const holdsText = kinds.filter((type) => kindOf(type).text);
    expect([...holdsText].sort()).toEqual(["card", "connector", "shape", "sticky_note", "text"]);
  });

  it("agrees with canConnect, which now only reads the table", () => {
    for (const type of kinds) {
      expect(canConnect(widget(type))).toBe(kindOf(type).connectable);
    }
    expect([...kinds.filter((type) => canConnect(widget(type)))].sort()).toEqual([
      "card",
      "image",
      "shape",
      "stamp",
      "sticky_note",
      "text",
    ]);
  });

  it("keeps cards out of layers and connectors out of arrange", () => {
    expect(kindOf("card").layered).toBe(false);
    expect(kindOf("connector").movable).toBe(false);
    // Everything else may be restacked and moved.
    expect(kinds.filter((type) => !kindOf(type).layered)).toEqual(["card"]);
    // A card's place is its cell, a line's is derived: neither has a free position.
    expect([...kinds.filter((type) => !kindOf(type).movable)].sort()).toEqual(["card", "connector"]);
  });

  it("lets notes, text, timers, frames and shapes take a resize handle", () => {
    expect([...kinds.filter((type) => kindOf(type).resizable)].sort()).toEqual([
      "frame",
      "shape",
      "sticky_note",
      "text",
      "timer",
    ]);
  });

  it("gives a frame a floor that keeps it a container (ADR-141)", () => {
    expect(minimumSizeOf("frame")).toEqual({ width: 160, height: 120 });
    // Every other kind keeps the generic floor: a handle and a word still fit.
    expect(minimumSizeOf("sticky_note")).toEqual(DEFAULT_MIN_SIZE);
    // A shape resizes like a note, floor included (ADR-145).
    expect(minimumSizeOf("shape")).toEqual({ width: 80, height: 60 });
    expect(minimumSizeOf("hologram")).toEqual(DEFAULT_MIN_SIZE);
  });

  it("does not group cards or lines", () => {
    expect([...kinds.filter((type) => !kindOf(type).groupable)].sort()).toEqual([
      "card",
      "connector",
    ]);
  });

  it("is conservative about a type this build does not know", () => {
    const unknown = kindOf("hologram");
    expect(unknown.text).toBe(false);
    expect(unknown.connectable).toBe(false);
    expect(unknown.editable).toBe(false);
    // It is still visible, movable and selectable: refusing to draw it would hide data.
    expect(unknown.rank).toBe(5);
    expect(unknown.movable).toBe(true);
  });

  it("gives every widget a layer key derived from its kind", () => {
    const ordered = paintOrder([widget("text"), widget("connector"), widget("frame")]);
    expect(ordered.map((w) => w.type)).toEqual(["frame", "connector", "text"]);
    expect(layerKey({ ...widget("connector"), z: 9999 })).toBe(9999);
  });
});
