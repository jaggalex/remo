/**
 * The board backup format (ADR-071).
 *
 * Deliberately not a database dump: the bundle uses domain names (`widgets`, `texts`,
 * `kanbans`) and can be read by a parser that knows nothing about remo tables. The
 * Yjs update is not included; import rebuilds the document from these plain maps
 * (ADR-085).
 */
import { createHash } from "node:crypto";
import { Y } from "./y.mjs";

/** Stable key order, so the checksum is the same on every export. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function checksumOf(content) {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(content)))
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * @param {{ state?: Uint8Array | null, boardId: string, title?: string }} input
 */
export function buildBoardBackup({ state, boardId, title, comments = [] }) {
  const doc = new Y.Doc();
  if (state?.length) Y.applyUpdate(doc, new Uint8Array(state));
  const widgets = doc.getMap("widgets").toJSON();
  const texts = doc.getMap("texts").toJSON();
  // Plain strings keep the bundle readable; the delta is what preserves bold/italic
  // when the file comes back through import. Both are cheap and either can be ignored.
  const textDeltas = {};
  doc.getMap("texts").forEach((text, id) => {
    if (typeof text?.toDelta !== "function") return;
    const delta = text
      .toDelta()
      .filter((op) => typeof op.insert === "string")
      .map((op) =>
        op.attributes && Object.keys(op.attributes).length
          ? { insert: op.insert, attributes: op.attributes }
          : { insert: op.insert },
      );
    if (delta.length) textDeltas[id] = delta;
  });
  const kanbans = doc.getMap("kanbans").toJSON();
  const meta = doc.getMap("meta").toJSON();
  const groupNames = doc.getMap("groupNames").toJSON();
  const tags = doc.getMap("tags").toJSON();
  const presentation = doc.getArray("presentation").toJSON();
  doc.destroy();

  const content = {
    format: "remo.board",
    version: 2,
    board: { id: boardId, title: title ?? meta.title ?? "" },
    widgets,
    texts,
    textDeltas,
    kanbans,
    meta,
    groupNames,
    tags,
    presentation,
    comments,
    assets: [],
  };
  const widgetList = Object.values(widgets);
  const counts = {
    widgets: widgetList.length,
    connectors: widgetList.filter((widget) => widget?.type === "connector").length,
    assets: 0,
  };
  return {
    manifest: {
      format: "remo.board.backup",
      version: 2,
      boardId,
      title: content.board.title,
      exportedAt: new Date().toISOString(),
      checksum: checksumOf(content),
      counts,
      files: [
        "widgets",
        "texts",
        "textDeltas",
        "kanbans",
        "meta",
        "groupNames",
        "tags",
        "presentation",
        "comments",
        "assets",
      ],
    },
    ...content,
  };
}

/** A parser can verify integrity without importing the board. */
export function verifyBoardBackup(bundle) {
  if (!bundle || bundle.manifest?.format !== "remo.board.backup") return false;
  // Version 1 is still readable: it simply has no `groupNames`, the only field
  // version 2 added.
  const version = bundle.manifest.version;
  if ((version !== 1 && version !== 2) || bundle.format !== "remo.board") return false;
  if (bundle.version !== version) return false;
  const { manifest, ...content } = bundle;
  return checksumOf(content) === manifest.checksum;
}
