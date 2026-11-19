import type { Widget } from "@remo/model";

/**
 * What the agent dialog promises will leave for the model (ADR-066, stage 5).
 *
 * The service sends the wording of the task and up to twenty short fragments of the
 * selected objects (`selectionTexts` in the runner: id, type, 200 characters). This
 * function mirrors that rule so the dialog shows the same list the model will see, not
 * a vague "some content may be sent".
 */
export interface PayloadFragment {
  id: string;
  type: string;
  text: string;
}

export const PAYLOAD_LIMIT = 20;
export const PAYLOAD_TEXT_LIMIT = 200;

export function payloadPreview(
  widgets: readonly Widget[],
  selectionIds: readonly string[],
): PayloadFragment[] {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  return selectionIds
    .slice(0, PAYLOAD_LIMIT)
    .map((id) => {
      const widget = byId.get(id);
      const raw = String(widget?.content ?? widget?.title ?? "");
      const text = raw
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { id, type: widget?.type ?? "unknown", text: text.slice(0, PAYLOAD_TEXT_LIMIT) };
    })
    .filter((fragment) => fragment.text.length > 0);
}

/** The server's selection cap (ADR-143); mirrored so the dialog tells the truth. */
export const SELECTION_OBJECT_LIMIT = 50;
export const SELECTION_CHAR_LIMIT = 20_000;

export interface SelectionPreview {
  /** Expanded ids, in reading order; what the tidy command may move. */
  ids: string[];
  objects: Array<{ id: string; type: string; text: string }>;
  texts: string[];
  chars: number;
  groups: number;
  frames: number;
  empty: number;
  duplicates: number;
  truncated: boolean;
}

function textOf(widget: Widget): string {
  return String(widget.content ?? widget.title ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The selection as the server reads it: groups expand to their members, a frame to
 * everything it contains, order is top-down then left-right, empty and repeated texts
 * are dropped, and the caps are the server's (ADR-143).
 *
 * This is a preview of the same rules, not a second rule: it shows the person exactly
 * what the model will see before the task is created.
 */
export function selectionPreview(
  widgets: readonly Widget[],
  selectionIds: readonly string[],
): SelectionPreview {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const requested = selectionIds.map(String);
  const groupIds = new Set(
    requested.map((id) => byId.get(id)?.groupId).filter((id): id is string => Boolean(id)),
  );
  const chosen = new Set<string>();
  for (const id of requested) {
    const widget = byId.get(id);
    if (widget && widget.type !== "connector") chosen.add(id);
  }
  if (groupIds.size) {
    for (const widget of widgets) {
      if (widget.groupId && groupIds.has(widget.groupId) && widget.type !== "connector") {
        chosen.add(widget.id);
      }
    }
  }
  const frameIds = new Set(
    [...chosen].filter((id) => byId.get(id)?.type === "frame"),
  );
  if (frameIds.size) {
    for (const widget of widgets) {
      let parent = widget.parentId ?? null;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        if (frameIds.has(parent)) {
          if (widget.type !== "connector") chosen.add(widget.id);
          break;
        }
        seen.add(parent);
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
  }

  const expanded = [...chosen]
    .map((id) => byId.get(id))
    .filter((widget): widget is Widget => Boolean(widget))
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x !== b.x ? a.x - b.x : a.id < b.id ? -1 : 1));

  const objects: SelectionPreview["objects"] = [];
  const texts: string[] = [];
  const seenTexts = new Set<string>();
  let chars = 0;
  let empty = 0;
  let duplicates = 0;
  let truncated = false;

  for (const widget of expanded) {
    if (objects.length >= SELECTION_OBJECT_LIMIT) {
      truncated = true;
      break;
    }
    const text = textOf(widget);
    if (!text) {
      empty += 1;
      objects.push({ id: widget.id, type: widget.type, text: "" });
      continue;
    }
    if (seenTexts.has(text)) {
      duplicates += 1;
      continue;
    }
    seenTexts.add(text);
    const remaining = SELECTION_CHAR_LIMIT - chars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const kept = text.length <= remaining ? text : text.slice(0, remaining).trimEnd();
    if (kept.length < text.length) truncated = true;
    chars += kept.length;
    objects.push({ id: widget.id, type: widget.type, text: kept });
    texts.push(kept);
    if (kept.length < text.length) break;
  }

  return {
    ids: objects.map((object) => object.id),
    objects,
    texts,
    chars,
    groups: groupIds.size,
    frames: frameIds.size,
    empty,
    duplicates,
    truncated,
  };
}
