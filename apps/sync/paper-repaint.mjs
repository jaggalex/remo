/**
 * Repaint a room document from the previous tonal rows to the paper tones (ADR-183).
 *
 * Pure: takes a `Y.Doc`, changes only values that are one of the fourteen previous fills,
 * and reports what it changed. `scripts/repaint-paper.mjs` loads and saves the rooms; this
 * module never touches the database, so it is tested without one.
 *
 * The table copies `PREVIOUS_FILL_LEVELS` → `TONE_LEVELS` from `@remo/model`
 * (`packages/model/src/colorLevels.ts`); `paper-repaint.test.mjs` compares the two.
 */
import { Y } from "./y.mjs";

/** Previous value → its paper successor, same tone and level (ADR-182). */
export const PAPER_REPAINT = Object.freeze({
  "#efece8": "#f3f1ec",
  "#bfb9b1": "#cdc8c0",
  "#ffe07a": "#ece2c8",
  "#f2b94a": "#d8c79e",
  "#ffcd9e": "#e2d2c4",
  "#ff8a57": "#bca996",
  "#ffc6d9": "#e8d6d3",
  "#ff8fbd": "#cdb0ab",
  "#d9c9ff": "#dcd8e2",
  "#c69bff": "#b9b1c9",
  "#b5dcff": "#d8dde3",
  "#78b4ff": "#aab7c5",
  "#b9ecac": "#dedfd4",
  "#85d965": "#bcbfa9",
});

/** The style fields that hold a colour; a widget without one is left alone. */
export const COLOUR_FIELDS = Object.freeze(["fillColor", "strokeColor", "textColor", "color"]);

/** The paper value for a stored colour, or null when it is not a previous fill. */
export function paperFor(value) {
  if (typeof value !== "string") return null;
  return PAPER_REPAINT[value.trim().toLowerCase()] ?? null;
}

/**
 * Count — and with `apply` rewrite — every previous fill in the document.
 *
 * @returns {{ widgets: number, columns: number, fills: Array<{ id: string, from: string, to: string }> }}
 *   `fills` lists widget fill changes so the caller can update the `widgets` projection.
 */
export function repaintDocument(doc, { apply = false, origin = "paper-repaint" } = {}) {
  const result = { widgets: 0, columns: 0, fills: [] };
  const run = () => {
    const widgets = doc.getMap("widgets");
    widgets.forEach((widget, id) => {
      if (!widget || typeof widget !== "object" || widget instanceof Y.AbstractType) return;
      const style = widget.style;
      if (!style || typeof style !== "object") return;
      const next = { ...style };
      let changed = false;
      for (const field of COLOUR_FIELDS) {
        const paper = paperFor(style[field]);
        if (!paper) continue;
        next[field] = paper;
        changed = true;
        if (field === "fillColor") result.fills.push({ id, from: style[field], to: paper });
      }
      if (!changed) return;
      result.widgets += 1;
      if (apply) widgets.set(id, { ...widget, style: next });
    });

    doc.getMap("kanbans").forEach((kanban) => {
      if (!(kanban instanceof Y.Map)) return;
      const columns = kanban.get("columns");
      if (!(columns instanceof Y.Array)) return;
      for (const column of columns.toArray()) {
        if (!(column instanceof Y.Map)) continue;
        const paper = paperFor(column.get("accent"));
        if (!paper) continue;
        result.columns += 1;
        if (apply) column.set("accent", paper);
      }
    });
  };
  if (apply) doc.transact(run, origin);
  else run();
  return result;
}
