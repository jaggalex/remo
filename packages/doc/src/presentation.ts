import type { Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Presentation order (ADR-108, ADR-165).
 *
 * A slide is any widget, not only a frame. The order lives in the document,
 * independent of canvas coordinates and stacking; the live "who is presenting" state
 * lives in awareness.
 */

export function frameWidgets(board: BoardDocument): Widget[] {
  return board.readWidgets().filter((widget) => widget.type === "frame");
}

/**
 * Whether the order has ever been edited.
 *
 * An untouched board shows every frame, which is the old meaning of an empty order.
 * Once someone edits the list, the stored ids are the whole truth and an empty list is
 * a real state: no slides.
 */
function presentationConfigured(board: BoardDocument): boolean {
  return board.meta.get("presentation_configured") === "1" || board.presentation.length > 0;
}

/** The ids of the slides, in order. */
export function presentationSlides(board: BoardDocument): string[] {
  if (!presentationConfigured(board)) return frameWidgets(board).map((frame) => frame.id);
  const existing = new Set(board.widgets.keys());
  return board.presentation.toArray().filter((id) => existing.has(id));
}

export interface PresentationStep {
  /** Unique across cells of one section and across slides. */
  id: string;
  /** The ordered slide this step belongs to. */
  slideId: string;
  /** The widget whose geometry the camera fits. */
  frameId: string;
  /** Present when the slide is a table section; absent means the whole frame. */
  cell?: { rowId: string; columnId: string };
}

/**
 * The presentation as concrete camera steps (ADR-200).
 *
 * A table section is one item in the order but several row-major steps: top row left to
 * right, then the next row. A section without both axes is one whole-frame step. The
 * order is derived from the axes, never stored as a second list. An empty cell is not a
 * step, and a table with no objects at all is one whole-frame step (ADR-201).
 */
export function presentationSteps(board: BoardDocument): PresentationStep[] {
  const steps: PresentationStep[] = [];
  for (const slideId of presentationSlides(board)) {
    const widget = board.readWidget(slideId);
    const layout = widget?.type === "frame" ? widget.layout : undefined;
    if (
      widget &&
      layout?.kind === "table" &&
      layout.active !== false &&
      layout.columns.length > 0 &&
      layout.rows.length > 0
    ) {
      const filled = new Set<string>();
      for (const child of board.readWidgets()) {
        if (child.parentId === slideId && child.cell) {
          filled.add(`${child.cell.rowId}:${child.cell.columnId}`);
        }
      }
      if (!filled.size) {
        steps.push({ id: slideId, slideId, frameId: slideId });
        continue;
      }
      for (const row of layout.rows) {
        for (const column of layout.columns) {
          if (!filled.has(`${row.id}:${column.id}`)) continue;
          steps.push({
            id: `${slideId}:${row.id}:${column.id}`,
            slideId,
            frameId: slideId,
            cell: { rowId: row.id, columnId: column.id },
          });
        }
      }
      continue;
    }
    if (widget) steps.push({ id: slideId, slideId, frameId: slideId });
  }
  return steps;
}

export function setPresentationOrder(board: BoardDocument, ids: readonly string[]): void {
  const existing = new Set(board.widgets.keys());
  const order = [...new Set(ids)].filter((id) => existing.has(id));
  board.transact(() => {
    board.presentation.delete(0, board.presentation.length);
    board.presentation.push(order);
    board.meta.set("presentation_configured", "1");
  });
}

/** Add objects to the end of the order, skipping ones already there. */
export function addPresentationSlides(board: BoardDocument, ids: readonly string[]): void {
  const order = presentationSlides(board);
  const present = new Set(order);
  for (const id of ids) {
    if (present.has(id)) continue;
    present.add(id);
    order.push(id);
  }
  setPresentationOrder(board, order);
}

/** Add one object to the end of the order, if it is not a slide already. */
export function addPresentationSlide(board: BoardDocument, id: string): void {
  addPresentationSlides(board, [id]);
}

export function addAllFrames(board: BoardDocument): void {
  const order = presentationSlides(board);
  const present = new Set(order);
  for (const frame of frameWidgets(board)) {
    if (!present.has(frame.id)) order.push(frame.id);
  }
  setPresentationOrder(board, order);
}

export function movePresentationSlide(
  board: BoardDocument,
  slideId: string,
  toIndex: number,
): void {
  const order = presentationSlides(board);
  const from = order.indexOf(slideId);
  if (from < 0) return;
  order.splice(from, 1);
  const target = Math.max(0, Math.min(order.length, toIndex));
  order.splice(target, 0, slideId);
  setPresentationOrder(board, order);
}

export function removePresentationSlide(board: BoardDocument, slideId: string): void {
  setPresentationOrder(
    board,
    presentationSlides(board).filter((id) => id !== slideId),
  );
}

/** The slide after/before the current one, wrapping at the ends. */
export function neighbouringSlide(
  slides: readonly string[],
  current: string,
  direction: 1 | -1,
): string | null {
  if (!slides.length) return null;
  const index = Math.max(0, slides.indexOf(current));
  return slides[(index + direction + slides.length) % slides.length] ?? null;
}

/** The label a person reads for an object: name, then title, then text, then id. */
export function slideLabel(widget: Widget): string {
  const name = widget.name?.trim();
  if (name) return name;
  const title = widget.title?.trim();
  if (title) return title;
  const text = widget.content?.trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return widget.id;
}
