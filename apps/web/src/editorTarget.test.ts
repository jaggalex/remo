/**
 * The inline editor's defaults, checked against the values a document holds.
 *
 * Regression for a review finding: when paint defaults moved into objectDefaults.ts, the
 * card branch kept the *name* as a string — `"DEFAULT_FILL"` — which is not a CSS colour.
 * Cards therefore opened over a transparent editor instead of the white sheet they paint.
 */
import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { editorTargetFor } from "./editorTarget";
import { DEFAULT_FILL } from "./objectDefaults";
import { DEFAULT_SETTINGS } from "./settings";

const RECT = { width: 1000, height: 800 } as DOMRect;
const CAMERA = { x: 0, y: 0, zoom: 1 };

function targetFor(widget: Widget) {
  return editorTargetFor({
    editingId: widget.id,
    widgets: [widget],
    layouts: new Map(),
    camera: CAMERA,
    settings: DEFAULT_SETTINGS,
    deltaOf: () => [],
    widgetById: () => widget,
    rect: RECT,
  });
}

function widget(type: Widget["type"], style?: Widget["style"]): Widget {
  return {
    id: `w-${type}`,
    type,
    parentId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    style,
  };
}

describe("card editor defaults", () => {
  it("opens a card on the same white fill it is painted with", () => {
    const target = targetFor(widget("card"));
    expect(target?.fill).toBe(DEFAULT_FILL);
    expect(target?.fill).toBe("#ffffff");
  });

  it("does not leak the constant's name as a colour", () => {
    expect(targetFor(widget("card"))?.fill).not.toBe("DEFAULT_FILL");
  });

  it("keeps the other branches unchanged", () => {
    expect(targetFor(widget("shape"))?.fill).toBe(DEFAULT_FILL);
    expect(targetFor(widget("shape", { fillColor: "#ffcc00" }))?.fill).toBe("#ffcc00");
    expect(targetFor(widget("text"))?.fill).toBe("transparent");
  });
});
