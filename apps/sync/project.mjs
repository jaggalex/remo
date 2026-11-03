/**
 * Board projection: Yjs document → relational rows.
 *
 * Kept pure on purpose: it takes a `Y.Doc` and returns plain rows, so it can be
 * unit-tested without a database and reused by any writer (the sync service now,
 * a backfill job later).
 */
import { Y } from "./y.mjs";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value) => (typeof value === "string" ? value : null);
const isMap = (value) => value instanceof Y.Map;

/**
 * Text lives in its own `Y.Text` per widget (it merges and streams better than a
 * field on the record), so the projection reads it from there and falls back to the
 * imported title/content only when a widget has never been edited.
 */
export function widgetText(doc, id, widget) {
  const shared = doc.getMap("texts").get(id);
  if (shared) return shared.toString();
  if (typeof widget.title === "string" && widget.title) return widget.title;
  return typeof widget.content === "string" ? widget.content : null;
}

/**
 * Modelled extras worth keeping in the read path: a sticker or lane caption, a shape
 * kind, connector endpoints and card fields. Absent keys are dropped so the column
 * stays small.
 */
export function projectProps(widget) {
  const props = {};
  if (typeof widget.label === "string") props.label = widget.label;
  if (widget.shapeKind) props.shapeKind = widget.shapeKind;
  // Connector endpoints: which two objects a line joins.
  if (widget.start?.item) props.startItem = widget.start.item;
  if (widget.end?.item) props.endItem = widget.end.item;
  if (widget.arrow) props.arrow = widget.arrow;
  // Card fields (ADR-106 amendment): the read API and the search projection keep
  // them next to the card, not in a separate table.
  if (widget.status) props.status = widget.status;
  if (widget.assigneeId) props.assigneeId = widget.assigneeId;
  if (widget.assigneeName) props.assigneeName = widget.assigneeName;
  if (widget.startAt) props.startAt = widget.startAt;
  if (widget.dueAt) props.dueAt = widget.dueAt;
  if (Array.isArray(widget.tagIds) && widget.tagIds.length) props.tagIds = widget.tagIds;
  return Object.keys(props).length ? props : null;
}

/** @returns visible widgets of a board document. */
export function projectWidgets(doc) {
  const widgets = [];
  doc.getMap("widgets").forEach((widget, id) => {
    if (!widget || typeof widget !== "object") return;
    const text = widgetText(doc, id, widget);
    widgets.push({
      id,
      type: str(widget.type) ?? "unknown",
      parentId: str(widget.parentId),
      x: num(widget.x),
      y: num(widget.y),
      width: num(widget.width),
      height: num(widget.height),
      title: widget.type === "card" ? text : str(widget.title),
      content: widget.type === "card" ? str(widget.content) : text,
      fillColor: str(widget.style?.fillColor),
      cardTheme: str(widget.style?.cardTheme),
      rotation: num(widget.rotation) ?? 0,
      props: projectProps(widget),
    });
  });
  return widgets.sort((a, b) => a.id.localeCompare(b.id));
}

/** @returns the kanban matrices of a board document, flattened. */
export function projectKanban(doc) {
  const columns = [];
  const swimlanes = [];
  const cards = [];

  doc.getMap("kanbans").forEach((kanban, kanbanId) => {
    // An editor can write any value here; the mirror skips what it cannot read rather
    // than stop the room from opening (ADR-160).
    if (!(kanban instanceof Y.Map)) return;
    const columnArray = kanban.get("columns");
    const swimlaneArray = kanban.get("swimlanes");
    const cardMap = kanban.get("cards");

    if (columnArray instanceof Y.Array) {
      columnArray.toArray().filter(isMap).forEach((column, index) => {
        columns.push({
          kanbanId,
          id: String(column.get("id")),
          title: str(column.get("title")) ?? "",
          accent: str(column.get("accent")),
          width: num(column.get("width")),
          wipLimit: num(column.get("wipLimit")),
          position: index,
        });
      });
    }

    if (swimlaneArray instanceof Y.Array) {
      swimlaneArray.toArray().filter(isMap).forEach((lane, index) => {
        swimlanes.push({
          kanbanId,
          id: String(lane.get("id")),
          title: str(lane.get("title")) ?? "",
          position: index,
        });
      });
    }

    if (cardMap instanceof Y.Map) {
      cardMap.forEach((placement, cardId) => {
        if (!isMap(placement)) return;
        cards.push({
          kanbanId,
          cardId,
          columnId: str(placement.get("columnId")) ?? "",
          swimlaneId: str(placement.get("swimlaneId")) ?? "",
          orderKey: str(placement.get("order")) ?? "n",
        });
      });
    }
  });

  const byPosition = (a, b) =>
    a.kanbanId.localeCompare(b.kanbanId) || a.position - b.position;
  return {
    columns: columns.sort(byPosition),
    swimlanes: swimlanes.sort(byPosition),
    cards: cards.sort((a, b) =>
      a.kanbanId.localeCompare(b.kanbanId) || a.cardId.localeCompare(b.cardId),
    ),
  };
}

/** Board title, stored in the document so it syncs like everything else. */
export function projectMeta(doc) {
  const title = doc.getMap("meta").get("title");
  return { title: typeof title === "string" ? title : "" };
}

export function projectBoard(doc) {
  return {
    title: projectMeta(doc).title,
    widgets: projectWidgets(doc),
    kanban: projectKanban(doc),
  };
}

/**
 * Compare a previous projection with a new one.
 *
 * The projection is refreshed on a debounce while people edit; rewriting every
 * row each time would churn the table for no reason, so only rows that actually
 * changed are written.
 */
export function diffRows(previous, next, key) {
  const before = new Map(previous.map((row) => [key(row), JSON.stringify(row)]));
  const after = new Map(next.map((row) => [key(row), JSON.stringify(row)]));

  const inserted = [];
  const updated = [];
  const removed = [];

  for (const [id, json] of after) {
    const existing = before.get(id);
    if (existing === undefined) inserted.push(next.find((row) => key(row) === id));
    else if (existing !== json) updated.push(next.find((row) => key(row) === id));
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(previous.find((row) => key(row) === id));
  }

  return { inserted, updated, removed };
}
