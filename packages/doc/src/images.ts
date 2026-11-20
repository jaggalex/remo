import type { Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * The three things a person can change about an image object after it exists (ADR-249).
 *
 * Creating one is a server command (`board.image.create`), because the file must already
 * belong to the room. Everything after that is an ordinary document edit: a description,
 * a new file behind the same object, and the picture's own size. They live here so the
 * bar, the lightbox and any future command share one rule for each.
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

export interface ReplacementFile {
  fileId: string;
  naturalWidth: number;
  naturalHeight: number;
  dominantColor?: string;
}

/**
 * Put a new file behind the same object.
 *
 * The width is the person's decision and stays; the height follows the new picture, so
 * a replacement can never squash it. The centre is kept, so the object does not jump,
 * and a lock still refuses the change — a locked object is not editable anywhere else.
 */
export function replaceImageFile(
  board: BoardDocument,
  id: string,
  file: ReplacementFile,
  /** An object the upload created that the replacement absorbs (§4.1 has no "no object"). */
  strayId?: string,
): boolean {
  const width = Math.max(1, file.naturalWidth);
  const height = Math.max(1, file.naturalHeight);
  if (!file.fileId) return false;
  let applied = false;
  board.transact(() => {
    const current = board.readWidget(id);
    if (!current || current.type !== "image" || current.locked) return;
    const keptWidth = Math.max(1, current.width);
    const nextHeight = Math.max(1, Math.round((keptWidth * height) / width));
    const next: Widget = {
      ...current,
      fileId: file.fileId,
      naturalWidth: width,
      naturalHeight: height,
      width: keptWidth,
      height: nextHeight,
    };
    if (file.dominantColor) next.dominantColor = file.dominantColor;
    else delete next.dominantColor;
    board.widgets.set(id, next);
    // The upload route always creates an object; "Replace" means it must not survive.
    // Removing it in the same transaction keeps one undo step for one decision.
    if (strayId && strayId !== id && board.readWidget(strayId)) {
      board.widgets.delete(strayId);
      board.texts.delete(strayId);
    }
    applied = true;
  });
  return applied;
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
