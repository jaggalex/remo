import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { applyStyleSnapshot, BoardDocument, createWidget, setElevation, styleSnapshotOf } from "./board";

const base = { parentId: null, x: 0, y: 0, width: 200, height: 120 } as const;
const shape = (id: string, extra: Partial<Widget> = {}): Widget => ({
  id,
  type: "shape",
  shapeKind: "rectangle",
  ...base,
  ...extra,
});

function board(): BoardDocument {
  const doc = new BoardDocument();
  createWidget(doc, shape("sh"));
  createWidget(doc, { id: "fr", type: "frame", ...base, title: "F" });
  createWidget(doc, { id: "n", type: "sticky_note", ...base, style: { fillColor: "yellow" } });
  createWidget(doc, shape("locked", { locked: true }));
  return doc;
}

describe("setElevation (ADR-245)", () => {
  it("raises what can stand off the board, in one undo step, and skips the rest", () => {
    const doc = board();
    setElevation(doc, ["sh", "fr", "n", "locked"], "floating");
    expect(doc.widgets.get("sh")!.style?.elevation).toBe("floating");
    expect(doc.widgets.get("fr")!.style?.elevation).toBe("floating");
    expect(doc.widgets.get("n")!.style).toEqual({ fillColor: "yellow" });
    expect(doc.widgets.get("locked")!.style?.elevation).toBeUndefined();

    doc.undoOnce();
    expect(doc.widgets.get("sh")!.style?.elevation).toBeUndefined();
    expect(doc.widgets.get("fr")!.style?.elevation).toBeUndefined();
  });

  it("deletes the field when the object is put back flat", () => {
    const doc = board();
    setElevation(doc, ["sh"], "raised");
    setElevation(doc, ["sh"], null);
    expect(doc.widgets.get("sh")!.style).not.toHaveProperty("elevation");
  });

  it("does not carry a shape's level onto a note when a style is pasted", () => {
    const doc = board();
    setElevation(doc, ["sh"], "raised");
    const snapshot = styleSnapshotOf(doc, "sh")!;
    createWidget(doc, shape("sh2"));
    applyStyleSnapshot(doc, ["n", "sh2"], snapshot);
    expect(doc.widgets.get("n")!.style).not.toHaveProperty("elevation");
    expect(doc.widgets.get("sh2")!.style?.elevation).toBe("raised");
  });
});
