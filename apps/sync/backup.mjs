/**
 * The board backup format (ADR-071).
 *
 * Deliberately not a database dump: the bundle uses domain names (`widgets`, `texts`,
 * `kanbans`) and can be read by a parser that knows nothing about remo tables. The
 * Yjs update is not included; import rebuilds the document from these plain maps
 * (ADR-085).
 *
 * Version 3 fills `assets` with the files the room uses (ADR-249 §5.3). The builder stays
 * pure: the caller reads the bytes and hands them in, so a backup can be tested without a
 * file store and the 200 MiB decision stays in one place (`backup-assets.mjs`).
 */
import { createHash } from "node:crypto";
import { Y } from "./y.mjs";

/** Stable key order, so the checksum is the same on every export. */
export function canonical(value) {
  // PostgreSQL timestamps arrive as Dates and JSON sends their ISO strings.
  if (value instanceof Date) return value.toJSON();
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
 * @param {{
 *   state?: Uint8Array | null,
 *   boardId: string,
 *   title?: string,
 *   comments?: unknown[],
 *   assets?: Array<{ fileId: string, sha256: string, mime: string, width: number,
 *     height: number, alt?: string, data?: string }>,
 * }} input
 */
export function buildBoardBackup({
  state,
  boardId,
  title,
  comments = [],
  assets = [],
}) {
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
    // Version 3 fills the `assets` section that earlier versions reserved (ADR-249 §5.3).
    // A reader that knows only 1 and 2 still opens it: the extra array is ignored, and
    // the manifest version says which shape to expect.
    version: 3,
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
    assets,
  };
  const widgetList = Object.values(widgets);
  const counts = {
    widgets: widgetList.length,
    connectors: widgetList.filter((widget) => widget?.type === "connector").length,
    assets: assets.length,
  };
  return {
    manifest: {
      format: "remo.board.backup",
      version: 3,
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

/**
 * The files a board document uses, in the order a reader meets them.
 *
 * A backup embeds bytes for exactly these ids (`spec/images.md` §5.3): the document is the
 * authority, not the `widgets` projection, which a few seconds behind the live room would
 * silently drop a picture from the archive. The first non-empty description wins, because
 * the file itself keeps no `alt`.
 *
 * @param {Record<string, any>} widgets
 * @returns {Map<string, string>} fileId → alt (possibly empty)
 */
export function usedImageFiles(widgets) {
  const files = new Map();
  for (const widget of Object.values(widgets ?? {})) {
    if (widget?.type !== "image" || typeof widget.fileId !== "string") continue;
    const alt = typeof widget.alt === "string" ? widget.alt.trim() : "";
    const seen = files.get(widget.fileId);
    if (seen === undefined || (!seen && alt)) files.set(widget.fileId, alt);
  }
  return files;
}

/** A parser can verify integrity without importing the board. */
export function verifyBoardBackup(bundle) {
  if (!bundle || bundle.manifest?.format !== "remo.board.backup") return false;
  // Versions 1 and 2 are still readable: 2 added `groupNames` and `tags`, 3 fills
  // `assets`. A reader accepts every version it understands and refuses the rest.
  const version = bundle.manifest.version;
  if ((version !== 1 && version !== 2 && version !== 3) || bundle.format !== "remo.board") {
    return false;
  }
  if (bundle.version !== version) return false;
  const { manifest, ...content } = bundle;
  return checksumOf(content) === manifest.checksum;
}
