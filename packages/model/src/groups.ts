import type { Widget } from "./types";

/**
 * Selection with groups expanded.
 *
 * Clicking one member of a group selects the whole group, because a group has no
 * object of its own to click (ADR-022). The same expansion is applied to a
 * marquee, to Delete and to the context menu, so no command can act on half a
 * group by accident.
 */
export function expandGroups(widgets: readonly Widget[], ids: readonly string[]): string[] {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const groups = new Set<string>();
  for (const id of ids) {
    const groupId = byId.get(id)?.groupId;
    if (groupId) groups.add(groupId);
  }

  const out = new Set(ids);
  if (groups.size) {
    for (const widget of widgets) {
      if (widget.groupId && groups.has(widget.groupId)) out.add(widget.id);
    }
  }
  return [...out];
}

/** Members of one group, in document order. */
export function groupMembers(widgets: readonly Widget[], groupId: string): Widget[] {
  return widgets.filter((widget) => widget.groupId === groupId);
}

/**
 * The group id shared by every id in the selection, when the selection is exactly
 * one whole group. Used to draw one box around a group instead of an outline on
 * every member.
 */
export function soleSelectedGroup(
  widgets: readonly Widget[],
  ids: readonly string[],
): string | null {
  if (!ids.length) return null;
  const selected = new Set(ids);
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  let groupId: string | undefined;
  for (const id of ids) {
    const current = byId.get(id)?.groupId;
    if (!current) return null;
    if (groupId && current !== groupId) return null;
    groupId = current;
  }
  if (!groupId) return null;
  const members = groupMembers(widgets, groupId);
  if (members.length !== selected.size) return null;
  return members.every((widget) => selected.has(widget.id)) ? groupId : null;
}
