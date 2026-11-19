import type { Widget } from "@remo/model";

/**
 * How a voting row names an object (ADR-117).
 *
 * Title first, then the text, then the type and a short tail of the id — never "timer
 * without text". The board chips, the panel list, the results and the history all call
 * this, so one object cannot read differently in two places.
 */
export function objectLabel(
  id: string,
  widget: Widget | undefined,
  words: { typeName: (type: string) => string; unnamed: (tail: string) => string },
): string {
  const raw = String(widget?.title ?? widget?.content ?? "")
    .replace(/<[^>]*>/g, " ")
    .trim();
  if (raw) return raw.slice(0, 60);
  // A short id is readable as it is; the tail only helps when the id is a long hash.
  const tail = id.length > 8 ? id.slice(-4) : id;
  return widget ? `${words.typeName(widget.type)} · ${tail}` : words.unnamed(tail);
}

/** The text a row shows as its own label, before the type fallback. */
export function objectText(widget: Widget | undefined): string {
  return String(widget?.title ?? widget?.content ?? "")
    .replace(/<[^>]*>/g, " ")
    .trim();
}
