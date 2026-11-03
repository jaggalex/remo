import {
  STICKY_SIZES,
  routingOf,
  withRouting,
  type ConnectorRouting,
  type StickySize,
  type TextDeltaOp,
  type TextMarks,
  type Widget,
  type WidgetStyle,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { holdsText, noteMarksOf, setWidgetDelta } from "./text";

/**
 * The look of an object: fill, outline, text colour, text size, size preset, and the
 * copy/paste of a whole look.
 *
 * One command per kind of change, all skipping locked objects, so callers cannot
 * invent a fourth way to restyle something (ADR-053).
 */

/**
 * Recolour stickies (and only stickies — the source keeps named sticky colours and
 * hex card themes apart, see ADR-012 and the palette tests).
 */
export function setStickyColor(board: BoardDocument, ids: string[], color: string): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "sticky_note") continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, fillColor: color } });
    }
  });
}

/**
 * Fill, outline and outline width of shapes.
 *
 * The same bar serves notes and shapes; the difference is which fields apply. Keeping
 * one command for "the look of an object" is what stops the two from drifting apart
 * (ADR-033).
 */
export interface ShapeStylePatch {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  /** Solid or dashed outline; the painter reads it like a connector's dash (ADR-120). */
  strokeStyle?: "normal" | "dashed" | "dotted";
}

export function setShapeStyle(
  board: BoardDocument,
  ids: readonly string[],
  patch: ShapeStylePatch,
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "shape") continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, ...patch } });
    }
  });
}

/** Fill of any object that has one (notes and shapes). */
export function setFillColor(board: BoardDocument, ids: readonly string[], color: string): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || (widget.type !== "sticky_note" && widget.type !== "shape")) continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, fillColor: color } });
    }
  });
}

/**
 * Text colour of every object that draws text.
 *
 * A note, a shape and a connector label paint on a fill, so their ink is `textColor` and
 * `null` means "decide from the fill again" (ADR-038). A free text object has no fill and
 * the painter reads `color`; the same call writes it, so the colour window has one action
 * for the Text role whichever object carries it (ADR-127).
 */
export function setTextColor(
  board: BoardDocument,
  ids: readonly string[],
  color: string | null,
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget) continue;
      const holdsInk =
        widget.type === "sticky_note" ||
        widget.type === "shape" ||
        widget.type === "connector" ||
        widget.type === "text";
      if (!holdsInk) continue;
      if (widget.locked) continue;
      const style = { ...widget.style };
      if (widget.type === "text") {
        if (color) style.color = color;
        else delete style.color;
      } else if (color) style.textColor = color;
      else delete style.textColor;
      board.widgets.set(id, { ...widget, style });
    }
  });
}


/** Set the preset size of the notes in `ids`, keeping each centre. One undo step. */
export function setStickySize(board: BoardDocument, ids: string[], size: StickySize): void {
  const preset = STICKY_SIZES[size];
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "sticky_note") continue;
      if (widget.locked) continue;
      board.widgets.set(id, {
        ...widget,
        width: preset.width,
        height: preset.height,
        style: { ...widget.style, stickySize: size },
      });
    }
  });
}


/* ----------------------------------------------------- copy of a style --- */

/** What "Copy style" takes from an object, and "Paste style" puts back. */
export interface StyleSnapshot {
  type: Widget["type"];
  style: WidgetStyle;
  /** Whole-note emphasis, when the object is a note with any. */
  marks?: TextMarks;
  routing?: ConnectorRouting;
  arrow?: "none" | "end" | "both" | "start";
}

/**
 * The look of one object, without its content or position.
 *
 * The source product has Copy style / Paste style in its context menu; this is the
 * same idea: a note's colour, size preset, text size, alignment and emphasis travel;
 * a connector's shape, dashes and colour travel. Text, geometry and links do not.
 */
export function styleSnapshotOf(board: BoardDocument, id: string): StyleSnapshot | null {
  const widget = board.widgets.get(id);
  if (!widget) return null;
  const snapshot: StyleSnapshot = { type: widget.type, style: { ...widget.style } };
  if (widget.type === "connector") {
    snapshot.routing = routingOf(widget);
    snapshot.arrow = widget.arrow;
  }
  if (holdsText(widget)) {
    const marks = noteMarksOf(board, id);
    if (marks && Object.keys(marks).length) snapshot.marks = marks;
  }
  return snapshot;
}

/** Apply a copied style to every compatible object in `ids`, in one undo step. */
export function applyStyleSnapshot(
  board: BoardDocument,
  ids: readonly string[],
  snapshot: StyleSnapshot,
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.locked) continue;

      if (widget.type === "connector" && snapshot.type === "connector") {
        let next: Widget = {
          ...widget,
          style: { ...widget.style, ...snapshot.style },
        };
        if (snapshot.routing) next = withRouting(next, snapshot.routing);
        if (snapshot.arrow) next.arrow = snapshot.arrow;
        board.widgets.set(id, next);
        continue;
      }

      if (!holdsText(widget) || !holdsText({ ...widget, type: snapshot.type })) continue;
      const sized =
        widget.type === "sticky_note" && snapshot.style.stickySize
          ? {
              width: STICKY_SIZES[snapshot.style.stickySize].width,
              height: STICKY_SIZES[snapshot.style.stickySize].height,
            }
          : {};
      board.widgets.set(id, {
        ...widget,
        ...sized,
        style: { ...widget.style, ...snapshot.style },
      });
      if (snapshot.marks) {
        const marks = snapshot.marks;
        const delta: TextDeltaOp[] = board.deltaOf(id).map((op) => {
          const attributes: TextMarks = { ...(op.attributes ?? {}) };
          for (const key of ["bold", "italic", "underline", "strike"] as const) {
            if (marks[key]) attributes[key] = true;
            else delete attributes[key];
          }
          return Object.keys(attributes).length
            ? { insert: op.insert, attributes }
            : { insert: op.insert };
        });
        if (delta.length) setWidgetDelta(board, id, delta);
      }
    }
  });
}

/** Empty the text of the given notes and cards. One undo step. */
