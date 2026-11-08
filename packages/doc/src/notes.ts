import {
  DEFAULT_LINE_PRESET,
  DEFAULT_SHAPE_PRESET,
  shapePresetStyle,
  type ConnectorSide,
  type ShapeKind,
  type Widget,
  type WidgetStyle,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { routingFromShape, type ConnectorOptions } from "./connectors";
import { holdsText, seedTextField } from "./text";
import { createWidget } from "./widgets";

/**
 * Notes and shapes: authoring them, sizing them, and the chain a Tab key grows.
 *
 * The gap and the Auto-fit rules are here because they are the same question seen from
 * two sides: how much room a note needs before the next one starts (ADR-027, ADR-028).
 */

/* ------------------------------------------------------- authoring widgets -- */

/** Default size per shape kind, and the kinds a person can add. */
export const SHAPE_SIZES: Record<string, { width: number; height: number }> = {
  rectangle: { width: 260, height: 160 },
  round_rectangle: { width: 260, height: 160 },
  ellipse: { width: 240, height: 240 },
  diamond: { width: 240, height: 200 },
  triangle: { width: 240, height: 200 },
};

export const DEFAULT_STICKY_SIZE = { width: 161.2, height: 184.7 };

/** Add a sticky note at a point; its text is editable straight away. */
export function createSticky(
  board: BoardDocument,
  id: string,
  at: { x: number; y: number },
  color: string = "yellow",
): string {
  createWidget(board, {
    id,
    type: "sticky_note",
    parentId: null,
    x: at.x,
    y: at.y,
    width: DEFAULT_STICKY_SIZE.width,
    height: DEFAULT_STICKY_SIZE.height,
    style: { fillColor: color },
  });
  return id;
}

/** Add a shape at a point. */
export function createShape(
  board: BoardDocument,
  id: string,
  kind: ShapeKind,
  at: { x: number; y: number },
  style: WidgetStyle = {},
): string {
  const size = SHAPE_SIZES[kind] ?? SHAPE_SIZES.rectangle!;
  createWidget(board, {
    id,
    type: "shape",
    parentId: null,
    x: at.x,
    y: at.y,
    width: size.width,
    height: size.height,
    shapeKind: kind,
    // The Plain preset: a new shape rings its own style sample on the first open
    // (ADR-129). The caller may override any part of it.
    style: { ...shapePresetStyle(DEFAULT_SHAPE_PRESET), ...style },
  });
  return id;
}

/* ------------------------------------------------------ connected notes --- */

export type NoteDirection = "left" | "right" | "up" | "down";

/**
 * Gap between a note and the one created next to it.
 *
 * Proportional to the note: a fixed number looks right for one size and cramped for
 * another, and a cramped gap leaves no room for the connector's stubs. The source
 * product leaves roughly a third of a note between chained notes.
 */
export const NOTE_GAP_RATIO = 0.36;

export interface GapOptions {
  /** Gap as a share of the note; defaults to `NOTE_GAP_RATIO`. */
  ratio?: number;
  /** The gap never goes below this. */
  min?: number;
}

/**
 * Gap for a note of this size, never below a readable minimum.
 *
 * The numbers come from the person's settings, so the distance a chain grows by is
 * something they can try rather than a constant (ADR-032).
 */
export function noteGap(width: number, height: number, options: GapOptions = {}): number {
  const ratio = options.ratio ?? NOTE_GAP_RATIO;
  const min = options.min ?? 56;
  return Math.max(min, Math.round(Math.max(width, height) * ratio));
}

/**
 * Centre of the copy grown from `source` in `direction` (ADR-028, ADR-137).
 *
 * The offset is the source's own extent plus the gap, never a constant: the copy clears
 * an object of any size, and a port click asks about the same rectangle the `Tab` chain
 * would create. The gap floor of one unit keeps two copies from sharing an edge when a
 * person tunes the gap down to zero.
 */
export function connectedNoteCenter(
  source: Pick<Widget, "x" | "y" | "width" | "height">,
  direction: NoteDirection,
  options: GapOptions = {},
): { x: number; y: number } {
  const gap = Math.max(1, noteGap(source.width, source.height, options));
  const dx = direction === "right" ? source.width + gap : direction === "left" ? -(source.width + gap) : 0;
  const dy = direction === "down" ? source.height + gap : direction === "up" ? -(source.height + gap) : 0;
  return { x: source.x + dx, y: source.y + dy };
}

/** Side of the source a new note in `direction` leaves from. */
function oppositeSide(direction: NoteDirection): ConnectorSide {
  return direction === "right"
    ? "right"
    : direction === "left"
      ? "left"
      : direction === "down"
        ? "bottom"
        : "top";
}

/** Side of the new note that faces the source. */
function directionToSide(direction: NoteDirection): ConnectorSide {
  return direction === "right"
    ? "left"
    : direction === "left"
      ? "right"
      : direction === "down"
        ? "top"
        : "bottom";
}

/**
 * Create a note beside `sourceId` and link the two (ADR-028).
 *
 * The new note inherits the colour, size, text size and alignment of its parent, so
 * a sequence of Tab presses reads as one thought. The connector is created in the
 * same transaction, which is why the pair arrives and undoes as one step. The arrow
 * points at the new note, the way the source product draws it.
 */
export function createConnectedNote(
  board: BoardDocument,
  sourceId: string,
  direction: NoteDirection,
  ids: { note: string; connector: string },
  /** Style for the new link; the caller passes the last one the person used. */
  connectorStyle: ConnectorOptions = {},
  /** Where the next note lands; the caller passes the tuned gap. */
  gapOptions: GapOptions = {},
): string | null {
  let created: string | null = null;

  board.transact(() => {
    const source = board.readWidget(sourceId);
    if (!source || !holdsText(source)) return;

    const width = source.width;
    const height = source.height;
    const center = connectedNoteCenter(source, direction, gapOptions);

    // The "+" chain clones the object it grows from: a note makes a note, a shape
    // makes the same shape with the same style, text makes text.
    const type = source.type === "shape" || source.type === "text" ? source.type : "sticky_note";
    const note: Widget = {
      id: ids.note,
      type,
      parentId: source.parentId,
      x: center.x,
      y: center.y,
      width,
      height,
      ...(type === "shape" ? { shapeKind: source.shapeKind ?? "rectangle" } : {}),
      style: { ...source.style },
    };
    board.widgets.set(note.id, note);
    seedTextField(board, note, "");

    const connector: Widget = {
      id: ids.connector,
      type: "connector",
      parentId: null,
      x: (source.x + note.x) / 2,
      y: (source.y + note.y) / 2,
      width: Math.abs(note.x - source.x),
      height: Math.abs(note.y - source.y),
      start: { item: source.id, side: oppositeSide(direction) },
      end: { item: note.id, side: directionToSide(direction) },
      arrow: connectorStyle.arrow ?? "end",
      routing: connectorStyle.routing ?? (connectorStyle.shape ? routingFromShape(connectorStyle.shape) : "elbow"),
      style: {
        strokeColor: connectorStyle.strokeColor ?? DEFAULT_LINE_PRESET.color,
        strokeWidth: connectorStyle.strokeWidth ?? DEFAULT_LINE_PRESET.width,
        ...(connectorStyle.strokeStyle ? { strokeStyle: connectorStyle.strokeStyle } : {}),
      },
    };
    board.widgets.set(connector.id, connector);
    created = note.id;
  });

  return created;
}

