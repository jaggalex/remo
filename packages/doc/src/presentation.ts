import type { Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Presentation order (ADR-108).
 *
 * Only frames are slides. The order lives in the document, independent of canvas
 * coordinates and stacking; the live "who is presenting" state lives in awareness.
 */

export function frameWidgets(board: BoardDocument): Widget[] {
  return [...board.widgets.values()].filter((widget) => widget.type === "frame");
}

/**
 * Frames in the saved order.
 *
 * An empty order means "all frames", which is the initial state; once someone has
 * ordered or removed a slide, only the stored ids are slides. A frame added later is
 * shown in the panel as available and joins the order through "add all".
 */
export function presentationFrames(board: BoardDocument): string[] {
  const frames = new Set(frameWidgets(board).map((frame) => frame.id));
  if (board.presentation.length === 0) return [...frames];
  return board.presentation.toArray().filter((id) => frames.has(id));
}

export function setPresentationOrder(board: BoardDocument, frameIds: readonly string[]): void {
  const frames = new Set(frameWidgets(board).map((frame) => frame.id));
  const order = [...new Set(frameIds)].filter((id) => frames.has(id));
  board.transact(() => {
    board.presentation.delete(0, board.presentation.length);
    board.presentation.push(order);
  });
}

export function addAllFrames(board: BoardDocument): void {
  setPresentationOrder(
    board,
    frameWidgets(board).map((frame) => frame.id),
  );
}

export function movePresentationFrame(
  board: BoardDocument,
  frameId: string,
  toIndex: number,
): void {
  const order = presentationFrames(board);
  const from = order.indexOf(frameId);
  if (from < 0) return;
  order.splice(from, 1);
  const target = Math.max(0, Math.min(order.length, toIndex));
  order.splice(target, 0, frameId);
  setPresentationOrder(board, order);
}

export function removePresentationFrame(board: BoardDocument, frameId: string): void {
  setPresentationOrder(
    board,
    board.presentation.toArray().filter((id) => id !== frameId),
  );
}

/** The frame after/before the current one, wrapping at the ends. */
export function neighbouringFrame(
  frames: readonly string[],
  current: string,
  direction: 1 | -1,
): string | null {
  if (!frames.length) return null;
  const index = Math.max(0, frames.indexOf(current));
  return frames[(index + direction + frames.length) % frames.length] ?? null;
}
