import type { WidgetLink } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Links on an object (ADR-103).
 *
 * A link is content, not access: an internal link is the same `?room=&select=` URL the
 * product already understands, and opening it still runs the normal access check.
 */

const MAX_URL = 2048;

/** A safe external URL, or null. Only http, https and mailto; no credentials. */
export function safeExternalUrl(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > MAX_URL || /[\u0000-\u001f\u007f]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (url.protocol !== "mailto:" && !url.hostname) return null;
  return url.toString();
}

export function setWidgetLink(
  board: BoardDocument,
  widgetId: string,
  link: WidgetLink | null,
): boolean {
  const widget = board.widgets.get(widgetId);
  if (!widget || widget.locked) return false;

  let next: WidgetLink | null = null;
  if (link?.kind === "url") {
    const url = safeExternalUrl(link.url);
    if (!url) return false;
    next = { kind: "url", url };
  } else if (link?.kind === "widget") {
    if (link.widgetId === widgetId || !board.widgets.has(link.widgetId)) return false;
    next = { kind: "widget", widgetId: link.widgetId };
  } else if (link) {
    return false;
  }

  board.transact(() => {
    const value = { ...widget };
    if (next) value.link = next;
    else delete value.link;
    board.widgets.set(widgetId, value);
  });
  return true;
}

/** The internal link target, if the widget has one that still exists. */
export function internalLinkTarget(
  board: BoardDocument,
  widgetId: string,
): string | null {
  const link = board.widgets.get(widgetId)?.link;
  if (link?.kind !== "widget") return null;
  return board.widgets.has(link.widgetId) ? link.widgetId : null;
}
