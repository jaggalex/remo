import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import {
  PAYLOAD_LIMIT,
  PAYLOAD_TEXT_LIMIT,
  SELECTION_CHAR_LIMIT,
  SELECTION_OBJECT_LIMIT,
  payloadPreview,
  selectionPreview,
} from "./agentPayload";

function note(id: string, content: string): Widget {
  return {
    id,
    type: "sticky_note",
    parentId: null,
    x: 0,
    y: 0,
    width: 160,
    height: 180,
    content,
  };
}

describe("agent payload preview (stage 5)", () => {
  it("lists only selected objects, in selection order", () => {
    const widgets = [note("a", "Alpha"), note("b", "Beta"), note("c", "<p>Gamma</p>")];
    expect(payloadPreview(widgets, ["c", "a"]).map((item) => item.text)).toEqual([
      "Gamma",
      "Alpha",
    ]);
  });

  it("caps the count and the fragment length, exactly like the runner", () => {
    const widgets = Array.from({ length: 30 }, (_, index) =>
      note(`n${index}`, "x".repeat(400)),
    );
    const preview = payloadPreview(
      widgets,
      widgets.map((widget) => widget.id),
    );
    expect(preview).toHaveLength(PAYLOAD_LIMIT);
    expect(preview[0]!.text).toHaveLength(PAYLOAD_TEXT_LIMIT);
  });

  it("skips objects without text and unknown ids", () => {
    const widgets = [note("empty", "  "), note("filled", "kept")];
    expect(payloadPreview(widgets, ["empty", "missing", "filled"])).toEqual([
      { id: "filled", type: "sticky_note", text: "kept" },
    ]);
  });
});

describe("selection preview (ADR-143)", () => {
  function at(id: string, x: number, y: number, content: string, extra: Partial<Widget> = {}): Widget {
    return { ...note(id, content), x, y, ...extra };
  }

  it("expands groups and frames, reads top-down and drops empty and repeated text", () => {
    const widgets = [
      at("a", 400, 100, "US-1"),
      at("b", 0, 500, "US-2"),
      at("g", 800, 800, "Group", { groupId: "g1" }),
      at("g2", 900, 800, "Group two", { groupId: "g1" }),
      {
        id: "frame",
        type: "frame",
        parentId: null,
        x: 0,
        y: 1200,
        width: 600,
        height: 400,
        title: "Lane",
      } as Widget,
      at("f", 0, 1200, "Inside", { parentId: "frame" }),
      at("empty", 0, 0, "   "),
      at("dup", 0, 700, "US-1"),
    ];
    const preview = selectionPreview(widgets, ["a", "g", "frame", "empty", "dup"]);
    expect(preview.ids).toEqual(["empty", "a", "g", "g2", "f", "frame"]);
    expect(preview.texts).toEqual(["US-1", "Group", "Group two", "Inside", "Lane"]);
    expect(preview.groups).toBe(1);
    expect(preview.frames).toBe(1);
    expect(preview.empty).toBe(1);
    expect(preview.duplicates).toBe(1);
  });

  it("stops at the object cap and reports truncation", () => {
    const widgets = Array.from({ length: 60 }, (_, index) =>
      at(`n${index}`, index * 10, 0, `Note ${index}`),
    );
    const preview = selectionPreview(widgets, widgets.map((widget) => widget.id));
    expect(preview.objects).toHaveLength(SELECTION_OBJECT_LIMIT);
    expect(preview.truncated).toBe(true);
  });

  it("cuts the text at the character cap", () => {
    const widgets = [at("long", 0, 0, "word ".repeat(8_000))];
    const preview = selectionPreview(widgets, ["long"]);
    expect(preview.chars).toBeLessThanOrEqual(SELECTION_CHAR_LIMIT);
    expect(preview.truncated).toBe(true);
  });
});
