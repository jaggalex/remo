import type { BoardDocument } from "./board";

/**
 * Widgets owned by `id`, transitively.
 *
 * Frames own their contents and a kanban owns its cards, so moving or deleting one
 * has to take its children along — in the captured templates the story map *is* a
 * stack of frames, and moving a band with its stickies is the normal gesture.
 */
export function descendants(board: BoardDocument, id: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([id]);
  const queue = [id];

  while (queue.length) {
    const parent = queue.shift()!;
    board.widgets.forEach((widget, childId) => {
      if (widget.parentId !== parent || seen.has(childId)) return;
      seen.add(childId);
      found.push(childId);
      queue.push(childId);
    });
  }
  return found;
}
