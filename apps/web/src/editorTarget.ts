import {
  noteFontSizeFor,
  notePadding,
  textCapFor,
  textFloorFor,
  type Camera,
  type KanbanLayout,
} from "@remo/canvas";
import {
  inkFor,
  stickyFill,
  type TextDeltaOp,
  type TextRun,
  type Widget,
} from "@remo/model";
import type { EditorTarget } from "./InlineEditor";
import { connectorEditorTarget } from "./connectorEditor";
import { placementOfCard } from "./canvasGeometry";
import type { BoardSettings } from "./settings";
import { DEFAULT_FILL, DEFAULT_INK, DEFAULT_MUTED_INK } from "./objectDefaults";

/**
 * Where the inline editor sits and how it looks (ADR-038).
 *
 * The editor must cover the painted text exactly: same box, same font size, same
 * padding and the same fill, or the caret sits at a different scale from the letters
 * around it. Kept out of the canvas component so the geometry has one home.
 */
export function editorTargetFor({
  editingId,
  widgets,
  layouts,
  camera,
  settings,
  deltaOf,
  widgetById,
  rect,
}: {
  editingId: string | null;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  camera: Camera;
  settings: BoardSettings;
  deltaOf: (id: string) => TextDeltaOp[];
  widgetById: (id: string) => Widget | undefined;
  rect: DOMRect;
}): EditorTarget | null {
  if (!editingId) return null;
  const widget = widgets.find((entry) => entry.id === editingId);
  if (!widget) return null;

  const toScreen = (x: number, y: number) => ({
    left: (x - camera.x) * camera.zoom + rect.width / 2,
    top: (y - camera.y) * camera.zoom + rect.height / 2,
  });

  if (widget.type === "connector") {
    return connectorEditorTarget(
      widget,
      camera,
      rect,
      deltaOf(widget.id),
      widgetById,
      {
        max: settings.connectors.stubMax,
        ratio: settings.connectors.stubRatio,
      },
      settings.text.fontFamily,
    );
  }

  // A card's box comes from the kanban matrix, everything else from the widget.
  const cardPlacement = placementOfCard(layouts, editingId);
  const width = cardPlacement?.width ?? widget.width;
  const height = cardPlacement?.height ?? widget.height;
  const centerX = cardPlacement?.x ?? widget.x;
  const centerY = cardPlacement?.y ?? widget.y;
  const topLeft = toScreen(centerX - width / 2, centerY - height / 2);

  const isCard = widget.type === "card";
  const delta = deltaOf(widget.id);
  const runs: TextRun[] = delta
    .filter((op) => op.insert)
    .map((op) => ({ text: op.insert!, ...op.attributes }));

  // The editor must use exactly the size the painter picked, or the caret sits at a
  // different scale from the letters around it.
  const textSize = isCard
    ? 15
    : (noteFontSizeFor(
        runs,
        width,
        height,
        textCapFor(widget, settings.notes.fontCap),
        widget.style?.fontSize,
        settings.text.fontFamily,
        textFloorFor(widget),
      ) ?? 16);

  // The note's own fill and the ink that goes with it, so the editor shows the
  // colours the text will really have (ADR-038).
  const fill =
    widget.type === "sticky_note"
      ? stickyFill(widget.style?.fillColor)
      : widget.type === "shape"
        ? (widget.style?.fillColor ?? DEFAULT_FILL)
        : widget.type === "text"
          ? "transparent"
          : DEFAULT_FILL;

  return {
    id: widget.id,
    rect: {
      left: topLeft.left,
      top: topLeft.top,
      width: width * camera.zoom,
      height: height * camera.zoom,
    },
    delta,
    // No screen-space floor: the editor must be the same size as the painted text,
    // even when the note is zoomed far out.
    fontSize: Math.max(0.5, textSize * camera.zoom),
    // World padding, scaled: the same gap the painter uses.
    padding: notePadding(textSize) * camera.zoom,
    align: isCard ? ("left" as const) : (widget.style?.textAlign ?? ("center" as const)),
    vAlign: isCard ? ("top" as const) : (widget.style?.textVAlign ?? ("middle" as const)),
    fontWeight: widget.style?.fontSize && widget.style.fontSize > 24 ? 700 : 400,
    fill,
    ink:
      widget.type === "text"
        ? (widget.style?.color ?? DEFAULT_INK)
        : isCard
          ? DEFAULT_MUTED_INK
          : inkFor(fill, widget.style?.textColor),
    radius: widget.type === "sticky_note" ? 3 : 2,
  };
}
