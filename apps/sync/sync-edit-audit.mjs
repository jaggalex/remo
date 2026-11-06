/**
 * Who edited a room, and how much (ADR-175).
 *
 * Commands write an audit row, but the normal editing path is the Yjs socket: drags,
 * typing and pastes never went through a command and left no audit at all. One row per
 * frame would be unreadable and expensive; one row per session per window answers the
 * support question ("who changed this room, from which session, and how much") without
 * growing with keystrokes.
 *
 * The transaction origin is the socket (`Y.applyUpdate(doc, update, conn)`), and the
 * connection table maps that socket to its session. The row never carries content:
 * only counts, object ids and — when the window saw the previous value — field names.
 */
const WINDOW_MS = 60_000;
const MAX_IDS = 50;
const MAX_FIELDS = 20;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Field names that changed between two stored widget values.
 *
 * A widget is a plain object in the Yjs map, so a replacement is the only write Yjs
 * reports. Comparing the top-level keys is honest: `style` is reported as `style`, not
 * as `style.fillColor`, because the map never saw that smaller change.
 */
function changedFields(previous, current) {
  if (!isObject(previous) || !isObject(current)) return null;
  const fields = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (previous[key] !== current[key]) fields.push(key);
  }
  return fields;
}

/**
 * @param {object} options
 * @param {{ recordAudit?: Function }} options.store
 * @param {{ inc?: Function }} [options.metrics]
 * @param {{ log?: Function, error?: Function }} [options.log]
 * @param {number} [options.windowMs]
 */
export function createEditAudit({
  store,
  metrics = null,
  log = console,
  windowMs = WINDOW_MS,
  maxIds = MAX_IDS,
  maxFields = MAX_FIELDS,
}) {
  /** `${sessionId}|${boardId}` → aggregate for the open window. */
  const buffers = new Map();
  const attached = new WeakSet();
  let flushing = false;

  function bufferFor(auth) {
    const sessionId = auth?.session?.sessionId ?? null;
    const actorId = auth?.session?.user?.id ?? null;
    if (!sessionId && !actorId) return null;
    const boardId = auth?.boardId ?? null;
    if (!boardId) return null;
    const key = `${sessionId ?? actorId}|${boardId}`;
    let buffer = buffers.get(key);
    if (!buffer) {
      buffer = {
        boardId,
        orgId: auth?.orgId ?? null,
        actorId,
        sessionId,
        updates: 0,
        bytes: 0,
        ids: new Set(),
        fields: new Set(),
        seen: new Map(),
      };
      buffers.set(key, buffer);
    }
    return buffer;
  }

  function editable(auth) {
    return Boolean(auth?.access?.capabilities?.includes("board.edit"));
  }

  /** The top-level key of `type`, walking nested shared types to the map they live in. */
  function topLevelId(type, map) {
    let item = type?._item;
    while (item) {
      if (item.parent === map) return String(item.parentSub);
      item = item.parent?._item;
    }
    return null;
  }

  function touch(buffer, doc, transaction) {
    const widgets = doc.getMap("widgets");
    const texts = doc.getMap("texts");
    const kanbans = doc.getMap("kanbans");

    // `changed` is the one place Yjs names what changed. A direct map write has the map
    // and the key; a text or a nested kanban map has the shared type, and its parent
    // chain names the top-level object it belongs to.
    for (const [type, keys] of transaction.changed ?? []) {
      if (type === widgets) {
        for (const raw of keys) {
          const id = String(raw);
          if (buffer.ids.size >= maxIds && !buffer.ids.has(id)) continue;
          buffer.ids.add(id);
          const current = widgets.get(id);
          const previous = buffer.seen.get(id);
          const fields = previous === undefined ? null : changedFields(previous, current);
          if (fields === null) buffer.fields.add("*");
          else for (const field of fields) buffer.fields.add(field);
          buffer.seen.set(id, current);
        }
        continue;
      }
      if (type === texts) {
        for (const raw of keys) {
          const id = String(raw);
          if (buffer.ids.size >= maxIds && !buffer.ids.has(id)) continue;
          buffer.ids.add(id);
          buffer.fields.add("text");
        }
        continue;
      }
      if (type === kanbans) {
        for (const raw of keys) {
          const id = String(raw);
          if (buffer.ids.size >= maxIds && !buffer.ids.has(id)) continue;
          buffer.ids.add(id);
          buffer.fields.add("kanban");
        }
        continue;
      }
      // Nested: a Y.Text under `texts`, or a Y.Map inside a kanban's matrix.
      for (const [map, field] of [
        [texts, "text"],
        [kanbans, "kanban"],
      ]) {
        const id = topLevelId(type, map);
        if (!id) continue;
        if (buffer.ids.size < maxIds || buffer.ids.has(id)) buffer.ids.add(id);
        buffer.fields.add(field);
        break;
      }
    }
  }

  function attach(doc, authBySocket) {
    if (!doc || attached.has(doc)) return;
    attached.add(doc);

    // Bytes and frame count come from the update itself; changed keys come from the
    // transaction. Both carry the socket as origin, so no per-socket listener is added.
    doc.on("update", (update, origin) => {
      const auth = authBySocket.get(origin);
      if (!editable(auth)) return;
      const buffer = bufferFor(auth);
      if (!buffer) return;
      buffer.updates += 1;
      buffer.bytes += update.length;
    });

    // `afterTransaction` is emitted with the document as its second argument in Yjs 13;
    // the origin that names the socket lives on the transaction itself.
    doc.on("afterTransaction", (transaction) => {
      const auth = authBySocket.get(transaction.origin);
      if (!editable(auth)) return;
      const buffer = bufferFor(auth);
      if (!buffer) return;
      touch(buffer, doc, transaction);
    });
  }

  async function flush() {
    if (flushing || !buffers.size) return;
    flushing = true;
    const rows = [...buffers.entries()];
    buffers.clear();
    for (const [, buffer] of rows) {
      if (!buffer.updates && !buffer.ids.size) continue;
      // The disk fallback has no audit table; a missing method is not a dropped row.
      if (!store.recordAudit) continue;
      const objects = [...buffer.ids].slice(0, maxIds);
      const fields = [...buffer.fields].slice(0, maxFields);
      try {
        await store.recordAudit({
          actorType: "user",
          actorId: buffer.actorId,
          orgId: buffer.orgId,
          boardId: buffer.boardId,
          sessionId: buffer.sessionId,
          action: "board.document.edited",
          subject: `${buffer.ids.size} object${buffer.ids.size === 1 ? "" : "s"}`,
          after: {
            updates: buffer.updates,
            bytes: buffer.bytes,
            objects,
            fields,
            windowMs,
          },
        });
        metrics?.inc?.("remo_ws_edit_audit_rows_total");
      } catch (error) {
        metrics?.inc?.("remo_ws_edit_audit_dropped_total");
        log.error?.("[sync] edit audit failed:", error.message);
      }
    }
    flushing = false;
  }

  const timer = setInterval(() => void flush(), windowMs);
  timer.unref?.();

  return {
    attach,
    flush,
    stop() {
      clearInterval(timer);
    },
    /** Test hook: the open window count. */
    openWindows: () => buffers.size,
  };
}
