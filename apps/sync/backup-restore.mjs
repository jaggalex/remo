/**
 * Applying a verified board backup to a room document (ADR-071, ADR-249 §5.3).
 *
 * The browser used to do this with `loadBoard`; a backup with pictures has to be applied
 * on the server instead, because the bytes go through the image pipeline and the
 * `fileId`s are rewritten there. This module is the one writer of that replacement: the
 * document is rebuilt from the plain maps the format defines, never from a Yjs update, so
 * an import cannot smuggle in a type the backup does not describe.
 *
 * `fileIds` maps an old asset id to the id the target organisation now has. An asset
 * without bytes stays in the document under its old id: the read route cannot resolve it,
 * and the object shows the "unavailable" placeholder instead of disappearing (§9.6).
 */
import { Y } from "./y.mjs";

function plainWidgets(bundle) {
  const widgets = bundle?.widgets;
  if (!widgets || typeof widgets !== "object") return [];
  return Object.values(widgets).filter(
    (widget) => widget && typeof widget.id === "string" && typeof widget.type === "string",
  );
}

/** A text value that keeps the marks the backup carried (ADR-024, ADR-252). */
function textValue(delta, plain) {
  const ops = Array.isArray(delta)
    ? delta.filter((op) => op && typeof op.insert === "string" && op.insert.length > 0)
    : [];
  if (!ops.length) {
    const text = new Y.Text();
    if (typeof plain === "string" && plain) text.insert(0, plain);
    return text;
  }
  const rich = ops.some((op) => op.attributes && Object.keys(op.attributes).length);
  // The editor upgrades a plain value to `XmlText` on its first mark; starting there
  // when the backup already has marks avoids a second representation of the same text.
  const text = rich ? new Y.XmlText() : new Y.Text();
  text.applyDelta(ops);
  return text;
}

/** Nested `Y.Map`/`Y.Array` shape of one kanban matrix (the writer in `@remo/doc`). */
function writeKanban(kanbans, kanbanId, state) {
  if (!state || typeof state !== "object") return;
  const kanban = new Y.Map();
  kanbans.set(kanbanId, kanban);
  kanban.set("newColumnWidth", Number(state.newColumnWidth) || 574.6);
  kanban.set("headerHeight", Number(state.headerHeight) || 96);

  const columns = new Y.Array();
  for (const column of Array.isArray(state.columns) ? state.columns : []) {
    if (!column || typeof column.id !== "string") continue;
    const entry = new Y.Map();
    entry.set("id", column.id);
    entry.set("title", String(column.title ?? ""));
    entry.set("accent", String(column.accent ?? ""));
    entry.set("width", Number(column.width) || 574.6);
    if (column.wipLimit != null) entry.set("wipLimit", Number(column.wipLimit));
    columns.push([entry]);
  }
  kanban.set("columns", columns);

  const swimlanes = new Y.Array();
  for (const lane of Array.isArray(state.swimlanes) ? state.swimlanes : []) {
    if (!lane || typeof lane.id !== "string") continue;
    const entry = new Y.Map();
    entry.set("id", lane.id);
    entry.set("title", String(lane.title ?? ""));
    swimlanes.push([entry]);
  }
  kanban.set("swimlanes", swimlanes);

  const cards = new Y.Map();
  for (const [cardId, placement] of Object.entries(state.cards ?? {})) {
    if (!placement || typeof placement !== "object") continue;
    const entry = new Y.Map();
    entry.set("columnId", String(placement.columnId ?? ""));
    entry.set("swimlaneId", String(placement.swimlaneId ?? ""));
    entry.set("order", String(placement.order ?? "n"));
    cards.set(cardId, entry);
  }
  kanban.set("cards", cards);
}

/**
 * Replace a room's document with a verified backup.
 *
 * The title follows the existing import: a room that already has a name keeps it, and an
 * untitled room takes the backup's. Everything else in `meta` stays as it is, because the
 * backup format only defines the title there.
 *
 * @param {Y.Doc | any} doc a live room document
 * @param {any} bundle verified backup content (`manifest` already checked)
 * @param {{ fileIds?: Map<string, string> }} [options]
 */
export function applyBoardBackup(doc, bundle, { fileIds = new Map() } = {}) {
  const widgets = doc.getMap("widgets");
  const texts = doc.getMap("texts");
  const kanbans = doc.getMap("kanbans");
  const meta = doc.getMap("meta");
  const groupNames = doc.getMap("groupNames");
  const tags = doc.getMap("tags");
  const presentation = doc.getArray("presentation");

  doc.transact(() => {
    widgets.clear();
    texts.clear();
    kanbans.clear();
    groupNames.clear();
    tags.clear();
    presentation.delete(0, presentation.length);

    for (const source of plainWidgets(bundle)) {
      const widget = { ...source };
      if (
        widget.type === "image" &&
        typeof widget.fileId === "string" &&
        fileIds.has(widget.fileId)
      ) {
        widget.fileId = fileIds.get(widget.fileId);
      }
      widgets.set(widget.id, widget);
      const fallback =
        typeof bundle.texts?.[widget.id] === "string"
          ? bundle.texts[widget.id]
          : (widget.title ?? widget.content ?? "");
      texts.set(widget.id, textValue(bundle.textDeltas?.[widget.id], fallback));
    }

    // A connector that lost an endpoint during remapping has nothing to join.
    for (const [id, widget] of [...widgets.entries()]) {
      if (widget?.type !== "connector") continue;
      if (!widget.start?.item || !widget.end?.item) widgets.delete(id);
    }

    for (const [groupId, name] of Object.entries(bundle.groupNames ?? {})) {
      groupNames.set(groupId, name);
    }
    for (const [tagId, tag] of Object.entries(bundle.tags ?? {})) {
      tags.set(tagId, tag);
    }
    if (Array.isArray(bundle.presentation) && bundle.presentation.length) {
      presentation.push(bundle.presentation);
    }
    for (const [kanbanId, state] of Object.entries(bundle.kanbans ?? {})) {
      writeKanban(kanbans, kanbanId, state);
    }

    if (!meta.get("title")) {
      const title = bundle.board?.title ?? bundle.meta?.title;
      if (typeof title === "string" && title.trim()) meta.set("title", title.trim());
    }
  });

  return { widgets: widgets.size, kanbans: kanbans.size };
}

/** How many pictures came back with bytes and how many will show a placeholder. */
export function assetOutcome(bundle) {
  let restored = 0;
  let placeholders = 0;
  for (const asset of Array.isArray(bundle?.assets) ? bundle.assets : []) {
    if (typeof asset?.data === "string" && asset.data.length) restored += 1;
    else placeholders += 1;
  }
  return { restored, placeholders };
}
