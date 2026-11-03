import type { Widget } from "@remo/model";

/**
 * Card filter conditions (ADR-112).
 *
 * A filter is a selection: it returns the cards that match, so the canvas stays fully
 * visible and the ordinary commands act on the result. Overdue is derived from the
 * viewer's local date, matching the card face.
 */
export interface CardFilter {
  assigneeId: string;
  due: "any" | "overdue" | "none";
}

export function todayIso(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function cardsMatching(
  widgets: readonly Widget[],
  filter: CardFilter,
  today = todayIso(),
): Widget[] {
  return widgets.filter((widget) => {
    if (widget.type !== "card") return false;
    if (filter.assigneeId && widget.assigneeId !== filter.assigneeId) return false;
    if (filter.due === "none") return !widget.dueAt;
    if (filter.due === "overdue") return Boolean(widget.dueAt && widget.dueAt < today);
    return true;
  });
}

/** Distinct assignees present on cards, by name, for the filter picker. */
export function cardAssignees(widgets: readonly Widget[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const widget of widgets) {
    if (widget.type !== "card" || !widget.assigneeId) continue;
    if (!seen.has(widget.assigneeId)) {
      seen.set(widget.assigneeId, widget.assigneeName || widget.assigneeId);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}
