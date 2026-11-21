import type { Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * The three things a person can change about an image object after it exists (ADR-249).
 *
 * Creating one and replacing its file are server commands (`board.image.create`,
 * `board.image.replace`), because the file must already belong to the room. Everything
 * after that is an ordinary document edit: a description and the picture's own size.
 * They live here so the bar and the lightbox share one rule for each.
 */

/** `files.alt` and the command validator cap the description at 500 (§3.2). */
export const MAX_ALT = 500;

/**
 * The largest box "Original size" may produce.
 *
 * A 6000 px photo at 100 % would be six thousand board units of picture next to a
 * 160-unit note; the cap keeps the object in the same world as everything else.
 */
export const MAX_IMAGE_SIDE = 2048;

/** Read the picture fields of a widget that may not be an image. */
export function imageFields(widget: Widget | undefined): {
  fileId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  dominantColor?: string;
  alt?: string;
} {
  if (!widget || widget.type !== "image") return {};
  return {
    fileId: widget.fileId,
    naturalWidth: widget.naturalWidth,
    naturalHeight: widget.naturalHeight,
    dominantColor: widget.dominantColor,
    alt: widget.alt,
  };
}

/**
 * Set or clear the accessible description.
 *
 * The text is trimmed and capped here rather than at the field: a paste of a whole
 * paragraph must not produce a document the command validator would refuse.
 */
export function setImageAlt(board: BoardDocument, id: string, alt: string): void {
  const value = alt.trim().slice(0, MAX_ALT);
  board.transact(() => {
    const current = board.readWidget(id);
    if (!current || current.type !== "image") return;
    const next = { ...current };
    if (value) next.alt = value;
    else delete next.alt;
    board.widgets.set(id, next);
  });
}

/**
 * Resize the object to the picture's own pixels, capped at `MAX_IMAGE_SIDE`.
 *
 * A picture smaller than the cap grows to its real size; a huge one stops at the cap.
 * This is the only resize that ignores the object's proportion lock, because it *is*
 * the picture's proportion.
 */
export function fitImageToNaturalSize(board: BoardDocument, id: string): boolean {
  let applied = false;
  board.transact(() => {
    const current = board.readWidget(id);
    if (!current || current.type !== "image" || current.locked) return;
    const naturalWidth = current.naturalWidth ?? 0;
    const naturalHeight = current.naturalHeight ?? 0;
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(naturalWidth, naturalHeight));
    board.widgets.set(id, {
      ...current,
      width: Math.max(1, Math.round(naturalWidth * scale)),
      height: Math.max(1, Math.round(naturalHeight * scale)),
    });
    applied = true;
  });
  return applied;
}
