import { kindOf, newId } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Groups as membership.
 *
 * A group is a `groupId` on its members, not a container with a box: moving it moves the
 * members, deleting any member dissolves the group, and one level is enough (ADR-022).
 * A name is a board-level label keyed by that id (ADR-101).
 */

/* --------------------------------------------------------------- groups --- */

/**
 * Put the selection into one group (ADR-022, ADR-101).
 *
 * Grouping is membership, not a container: the group has no object of its own.
 * Selected descendants are ignored when an ancestor is selected too — a frame and
 * its sticky are already one item. Cards and connectors are not grouped: a card's
 * place is a column, and a connector follows its endpoints.
 *
 * One level only: grouping a selection that already contains one group gives every
 * root that id, so adding an object to a named cluster keeps the name. A merge of
 * two groups mints a new id and drops both names — there is no honest way to choose
 * one of two names.
 */
export function groupWidgets(board: BoardDocument, ids: string[]): string | null {
  const selected = new Set(ids);
  const roots = [...new Set(ids)].filter((id) => {
    const widget = board.widgets.get(id);
    if (!widget || !kindOf(widget.type).groupable) return false;
    let parent = widget.parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = board.widgets.get(parent)?.parentId ?? null;
    }
    return true;
  });
  if (roots.length < 2) return null;

  // A group that is already exactly the selection must not be dissolved and
  // recreated: otherwise ⌘G on a group would silently lose its name.
  const existing = new Set(
    roots.map((id) => board.widgets.get(id)?.groupId).filter((id): id is string => Boolean(id)),
  );

  if (existing.size === 1) {
    const groupId = [...existing][0]!;
    const members = [...board.widgets.values()].filter((widget) => widget.groupId === groupId);
    if (
      members.length === roots.length &&
      members.every((widget) => selected.has(widget.id))
    ) {
      return groupId;
    }

    // Reuse the id when the selection is one group plus new roots: the name follows
    // the cluster instead of dying because a member was added.
    board.transact(() => {
      for (const id of roots) {
        const widget = board.widgets.get(id);
        if (!widget || widget.groupId === groupId) continue;
        board.widgets.set(id, { ...widget, groupId });
      }
    });
    return groupId;
  }

  const groupId = newId("grp");
  board.transact(() => {
    for (const id of roots) {
      const widget = board.widgets.get(id);
      if (!widget) continue;
      board.widgets.set(id, { ...widget, groupId });
    }
    // A merge of two named groups has no single name; remove the old labels so an
    // orphan name cannot outlive its membership.
    for (const oldId of existing) {
      if (![...board.widgets.values()].some((widget) => widget.groupId === oldId)) {
        board.groupNames.delete(oldId);
      }
    }
  });
  return groupId;
}

/** Dissolve every group touched by the selection. One undo step. */
export function ungroupWidgets(board: BoardDocument, ids: string[]): void {
  const groups = new Set<string>();
  for (const id of ids) {
    const groupId = board.widgets.get(id)?.groupId;
    if (groupId) groups.add(groupId);
  }
  if (!groups.size) return;

  board.transact(() => {
    const members = [...board.widgets.values()]
      .filter((widget) => widget.groupId && groups.has(widget.groupId))
      .map((widget) => widget.id);
    for (const id of members) {
      const widget = board.widgets.get(id);
      if (!widget) continue;
      const { groupId: _removed, ...rest } = widget;
      board.widgets.set(id, rest);
    }
    for (const groupId of groups) board.groupNames.delete(groupId);
  });
}

/* ------------------------------------------------------------ group name --- */

/** A group name is a label, not geometry: trim it and cap it at 64 characters. */
export function setGroupName(board: BoardDocument, groupId: string, name: string): void {
  if (!groupId) return;
  const trimmed = name.trim().slice(0, 64);
  board.transact(() => {
    if (trimmed) board.groupNames.set(groupId, trimmed);
    else board.groupNames.delete(groupId);
  });
}

/** The name of a group, or an empty string when it has never been named. */
export function groupNameOf(board: BoardDocument, groupId: string): string {
  return board.groupNames.get(groupId) ?? "";
}
