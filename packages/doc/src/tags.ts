import { newId, type Tag, type TagColor } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Board tag vocabulary (ADR-102).
 *
 * A tag is a record with an id; widgets carry `tagIds`. Renaming and deleting therefore
 * touch one place, not every object that happens to show the same word.
 */

function cleanName(value: string): string | null {
  const name = value.trim().slice(0, 32);
  return name ? name : null;
}

export function createTag(
  board: BoardDocument,
  name: string,
  color: TagColor,
): Tag | null {
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  if (board.tags.size >= 50) return null;
  const duplicate = [...board.tags.values()].some(
    (tag) => tag.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase(),
  );
  if (duplicate) return null;

  const tag: Tag = { id: newId("tag"), name: cleaned, color };
  board.transact(() => board.tags.set(tag.id, tag));
  return tag;
}

export function renameTag(board: BoardDocument, tagId: string, name: string): boolean {
  const current = board.tags.get(tagId);
  const cleaned = cleanName(name);
  if (!current || !cleaned) return false;
  const duplicate = [...board.tags.values()].some(
    (tag) =>
      tag.id !== tagId && tag.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase(),
  );
  if (duplicate) return false;
  board.transact(() => board.tags.set(tagId, { ...current, name: cleaned }));
  return true;
}

export function setTagColor(board: BoardDocument, tagId: string, color: TagColor): void {
  const current = board.tags.get(tagId);
  if (!current) return;
  board.transact(() => board.tags.set(tagId, { ...current, color }));
}

/** Delete a tag and every assignment in one undo step. */
export function deleteTag(board: BoardDocument, tagId: string): void {
  if (!board.tags.has(tagId)) return;
  board.transact(() => {
    board.tags.delete(tagId);
    for (const [id, widget] of board.widgets) {
      if (!widget.tagIds?.includes(tagId)) continue;
      const tagIds = widget.tagIds.filter((id) => id !== tagId);
      const next = { ...widget };
      if (tagIds.length) next.tagIds = tagIds;
      else delete next.tagIds;
      board.widgets.set(id, next);
    }
  });
}

/** Replace the tags on one object, keeping only ids that exist on the board. */
export function setWidgetTags(
  board: BoardDocument,
  widgetId: string,
  tagIds: readonly string[],
): void {
  const widget = board.widgets.get(widgetId);
  if (!widget || widget.locked) return;
  const kept = [...new Set(tagIds)].filter((id) => board.tags.has(id)).slice(0, 10);
  board.transact(() => {
    const next = { ...widget };
    if (kept.length) next.tagIds = kept;
    else delete next.tagIds;
    board.widgets.set(widgetId, next);
  });
}

export function toggleWidgetTag(
  board: BoardDocument,
  widgetId: string,
  tagId: string,
): void {
  const widget = board.widgets.get(widgetId);
  if (!widget) return;
  const current = widget.tagIds ?? [];
  setWidgetTags(
    board,
    widgetId,
    current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
  );
}

/** Widget ids carrying a tag, in document order. */
export function widgetsWithTag(board: BoardDocument, tagId: string): string[] {
  return [...board.widgets.values()]
    .filter((widget) => widget.tagIds?.includes(tagId))
    .map((widget) => widget.id);
}
