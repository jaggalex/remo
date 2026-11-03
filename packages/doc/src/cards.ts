import type { CardFields, CardStatus } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Card fields (ADR-106 amendment, R1).
 *
 * The card stays a widget with a title and a Y.Text body; these fields are plain values
 * on the widget record, like colour. A patch with `undefined` or an empty string clears
 * the field, which is how the inspector's "clear" actions work.
 */

const STATUSES = new Set<CardStatus>(["todo", "in_progress", "done"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TAGS = 10;

function date(value: string, field: string): string {
  if (!DATE.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a calendar date`);
  }
  return value;
}

export function setCardFields(
  board: BoardDocument,
  cardId: string,
  patch: CardFields,
): void {
  const current = board.widgets.get(cardId);
  if (!current || current.type !== "card" || current.locked) return;

  const next = { ...current };

  if ("status" in patch) {
    if (patch.status && !STATUSES.has(patch.status)) {
      throw new Error("unknown card status");
    }
    if (patch.status) next.status = patch.status;
    else delete next.status;
  }

  if ("assigneeId" in patch || "assigneeName" in patch) {
    const id = patch.assigneeId?.trim() || "";
    const name = patch.assigneeName?.trim() || "";
    if (id) {
      next.assigneeId = id;
      if (name) next.assigneeName = name;
      else delete next.assigneeName;
    } else {
      delete next.assigneeId;
      delete next.assigneeName;
    }
  }

  for (const field of ["startAt", "dueAt"] as const) {
    if (!(field in patch)) continue;
    const value = patch[field]?.trim() || "";
    if (value) next[field] = date(value, field);
    else delete next[field];
  }

  if ("tagIds" in patch) {
    const ids = [...new Set((patch.tagIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (ids.length > MAX_TAGS) throw new Error(`a card carries at most ${MAX_TAGS} tags`);
    if (ids.length) next.tagIds = ids;
    else delete next.tagIds;
  }

  board.transact(() => board.widgets.set(cardId, next));
}

/** The card's fields, or an empty object for anything that is not a card. */
export function cardFieldsOf(board: BoardDocument, cardId: string): CardFields {
  const widget = board.widgets.get(cardId);
  if (!widget || widget.type !== "card") return {};
  return {
    status: widget.status,
    assigneeId: widget.assigneeId,
    assigneeName: widget.assigneeName,
    startAt: widget.startAt,
    dueAt: widget.dueAt,
    tagIds: widget.tagIds,
  };
}
