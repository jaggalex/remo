import * as Y from "yjs";
import {
  kindOf,
  type TextDeltaOp,
  type TextMarks,
  type TextRun,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { LOCAL_ORIGIN } from "./origins";

/**
 * Text: storage, formatting and the commands that change it.
 *
 * Split out of `board.ts` because it is a feature with its own rules — `Y.XmlText`
 * versus `Y.Text`, marks per character, the line-height and fit rules — and because
 * the document class had grown into the place where everything lived (ADR-053).
 *
 * Nothing here imports the document module at runtime: `BoardDocument` is a type, and
 * the commands receive an instance. That keeps the dependency one-way.
 */

/* ------------------------------------------------------------- formatting -- */

/** Widget text lives in `Y.Text` (or `Y.XmlText`); painting reads it from there. */
export function withMaterializedText(
  widget: Widget,
  text: string,
  runs: TextRun[] | undefined,
): Widget {
  // `runs` is absent for plain text, so ordinary notes keep the plain painter and
  // exactly the layout they had before rich text.
  const formatted = runs?.some(hasMarks) ? { runs } : {};
  if (widget.type === "text" || widget.type === "sticky_note" || widget.type === "shape") {
    return { ...widget, content: text, ...formatted };
  }
  if (widget.type === "card") return { ...widget, title: text };
  if (widget.type === "connector") return { ...widget, content: text, ...formatted };
  return widget;
}

function hasMarks(run: TextRun): boolean {
  return Boolean(run.bold || run.italic || run.underline || run.strike);
}

/**
 * Plain text of a shared text value.
 *
 * `Y.XmlText.toString()` serializes tags (`<bold>Hello</bold>`), so it must never be
 * used for display; the delta is the only honest source.
 */
export function plainOf(text: Y.Text): string {
  if (text instanceof Y.XmlText) {
    return text
      .toDelta()
      .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  return text.toString();
}

/** Rich-text delta of a shared text value. Plain text is a one-op delta. */
export function deltaOf(text: Y.Text): TextDeltaOp[] {
  if (text instanceof Y.XmlText) {
    return text
      .toDelta()
      .filter((op: { insert?: unknown }) => typeof op.insert === "string")
      .map((op: { insert?: unknown; attributes?: unknown }) => {
        const attributes = op.attributes as TextMarks | undefined;
        return {
          insert: op.insert as string,
          ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
        };
      });
  }
  const plain = text.toString();
  return plain ? [{ insert: plain }] : [];
}

/**
 * Runs for the painter, or undefined when nothing is formatted.
 *
 * Adjacent operations with the same marks are merged, so the painter draws one
 * segment where the delta has several.
 */
export function runsOf(text: Y.Text): TextRun[] | undefined {
  if (!(text instanceof Y.XmlText)) return undefined;

  const runs: TextRun[] = [];
  for (const op of deltaOf(text)) {
    if (!op.insert) continue;
    const marks = op.attributes ?? {};
    const last = runs[runs.length - 1];
    if (last && sameMarks(last, marks)) {
      last.text += op.insert;
      continue;
    }
    runs.push({ text: op.insert, ...marks });
  }
  return runs.some(hasMarks) ? runs : undefined;
}

function sameMarks(run: TextRun, marks: TextMarks): boolean {
  return (
    Boolean(run.bold) === Boolean(marks.bold) &&
    Boolean(run.italic) === Boolean(marks.italic) &&
    Boolean(run.underline) === Boolean(marks.underline) &&
    Boolean(run.strike) === Boolean(marks.strike)
  );
}

/**
 * Widget types that carry text.
 *
 * Their shared text is created when the widget is, not on the first keystroke: if two
 * clients type into the same note before either has the shared text, both create a
 * `Y.Text` and Yjs keeps only one of them — the other client's typing is discarded.
 * Creating it up front makes the two creations content-identical, so the race is
 * harmless.
 */
/**
 * Whether this kind of object holds text (a line's label counts — ADR-041).
 *
 * The answer lives in the capability table, because the painter, the editor and the
 * style commands all have to agree on it (ADR-049).
 */
export function holdsText(widget: Widget): boolean {
  return kindOf(widget.type).text;
}

export function seedTextField(board: BoardDocument, widget: Widget, importText: string): void {
  if (!holdsText(widget) || board.texts.has(widget.id)) return;
  const shared = new Y.Text();
  if (importText) shared.insert(0, importText);
  board.texts.set(widget.id, shared);
}


/* --------------------------------------------------------------- text ops --- */

/**
 * Canonical form of a set of marks.
 *
 * Only the four marks this product has are kept, and an unset mark is absent
 * rather than `false`, so two deltas that mean the same thing compare equal.
 */
function canonicalMarks(marks?: TextMarks): TextMarks {
  const out: TextMarks = {};
  if (marks?.bold) out.bold = true;
  if (marks?.italic) out.italic = true;
  if (marks?.underline) out.underline = true;
  if (marks?.strike) out.strike = true;
  return out;
}

/** Identity of a mark set, for grouping adjacent characters. */
function marksKey(marks?: TextMarks): string {
  const m = canonicalMarks(marks);
  return `${m.bold ? "b" : ""}${m.italic ? "i" : ""}${m.underline ? "u" : ""}${m.strike ? "s" : ""}`;
}

/** Marks for an insertion; every mark is explicit, so nothing is inherited. */
function insertionMarks(marks: TextMarks): Record<string, true | null> {
  return {
    bold: marks.bold ? true : null,
    italic: marks.italic ? true : null,
    underline: marks.underline ? true : null,
    strike: marks.strike ? true : null,
  };
}

/** Merge adjacent operations with the same marks and drop empty ones. */
export function normalizeDelta(delta: readonly TextDeltaOp[]): TextDeltaOp[] {
  const out: TextDeltaOp[] = [];
  for (const op of delta) {
    if (!op.insert) continue;
    const key = marksKey(op.attributes);
    const last = out[out.length - 1];
    if (last && marksKey(last.attributes) === key) {
      last.insert += op.insert;
      continue;
    }
    const marks = canonicalMarks(op.attributes);
    out.push(
      Object.keys(marks).length ? { insert: op.insert, attributes: marks } : { insert: op.insert },
    );
  }
  return out;
}

/** Plain text of a delta, without marks. */
export function plainTextOf(delta: readonly TextDeltaOp[]): string {
  return delta.map((op) => op.insert).join("");
}

interface MarkedChar {
  ch: string;
  key: string;
  marks: TextMarks;
}

function charsOf(delta: readonly TextDeltaOp[]): MarkedChar[] {
  const chars: MarkedChar[] = [];
  for (const op of delta) {
    const marks = canonicalMarks(op.attributes);
    const key = marksKey(marks);
    for (const ch of op.insert) chars.push({ ch, key, marks });
  }
  return chars;
}

/** The shared text value as `Y.XmlText`, upgrading a plain one in place. */
function ensureXmlText(board: BoardDocument, id: string, plain: string): Y.XmlText {
  const existing = board.texts.get(id);
  if (existing instanceof Y.XmlText) return existing;

  // Lazy migration: a note that never had formatting keeps its `Y.Text` until the
  // first mark arrives, at which point the value is replaced by an `Y.XmlText` that
  // carries the same text. Must run inside a transaction, and the type must be in
  // the document before anything is inserted into it.
  const text = new Y.XmlText();
  board.texts.set(id, text);
  if (plain) text.insert(0, plain, {});
  return text;
}

/**
 * Set a widget's formatted text.
 *
 * The editor sends the whole delta on every input event; this reconciles it against
 * what the document already holds as a common-prefix / common-suffix diff, so two
 * people typing in the same note merge character-wise instead of overwriting each
 * other. A delta with no marks and no shared rich text is a plain edit and takes the
 * plain path, which keeps the cheap `Y.Text` merge and the existing height growth.
 */
export function setWidgetDelta(
  board: BoardDocument,
  id: string,
  delta: readonly TextDeltaOp[],
  options: { height?: number | null } = {},
): void {
  const widget = board.readWidget(id);
  if (!widget || widget.locked) return;

  const next = normalizeDelta(delta);
  const existing = board.texts.get(id);
  const hasMarks = next.some((op) => op.attributes && Object.keys(op.attributes).length);

  if (!hasMarks && !(existing instanceof Y.XmlText)) {
    setWidgetText(board, id, plainTextOf(next), options);
    return;
  }

  const current = board.deltaOf(id);
  const heightDiffers =
    options.height != null && Math.abs(widget.height - options.height) > 0.5;

  board.transact(() => {
    if (heightDiffers && options.height != null) {
      const live = board.readWidget(id);
      if (live) board.widgets.set(id, { ...live, height: options.height });
    }

    const text = ensureXmlText(board, id, plainTextOf(current));
    const currentChars = charsOf(current);
    const nextChars = charsOf(next);

    let prefix = 0;
    const maxPrefix = Math.min(currentChars.length, nextChars.length);
    while (prefix < maxPrefix && sameChar(currentChars[prefix]!, nextChars[prefix]!)) prefix += 1;

    let suffix = 0;
    const maxSuffix = Math.min(currentChars.length - prefix, nextChars.length - prefix);
    while (
      suffix < maxSuffix &&
      sameChar(
        currentChars[currentChars.length - 1 - suffix]!,
        nextChars[nextChars.length - 1 - suffix]!,
      )
    ) {
      suffix += 1;
    }

    // `charsOf` yields code points, so the diff counts are not the UTF-16 offsets
    // `Y.XmlText` expects. Convert before touching the shared text; an emoji is two
    // code units, and using the code-point count cut the string in the wrong place.
    const prefixOffset = utf16Length(currentChars, 0, prefix);
    const removeLength = utf16Length(currentChars, prefix, currentChars.length - suffix);
    if (removeLength > 0) text.delete(prefixOffset, removeLength);

    // Insert the changed middle, one run per set of marks. Marks are explicit so a
    // plain run is not silently painted with the formatting to its left.
    const end = nextChars.length - suffix;
    let index = prefixOffset;
    let i = prefix;
    while (i < end) {
      const key = nextChars[i]!.key;
      const marks = nextChars[i]!.marks;
      let value = "";
      while (i < end && nextChars[i]!.key === key) {
        value += nextChars[i]!.ch;
        i += 1;
      }
      text.insert(index, value, insertionMarks(marks));
      index += value.length;
    }
  }, LOCAL_ORIGIN, { merge: true });
}

function sameChar(a: MarkedChar, b: MarkedChar): boolean {
  return a.ch === b.ch && a.key === b.key;
}

/** UTF-16 length of a run of marked characters, the unit `Y.XmlText` indexes in. */
function utf16Length(chars: readonly MarkedChar[], from = 0, to = chars.length): number {
  let length = 0;
  for (let i = from; i < to; i += 1) length += chars[i]!.ch.length;
  return length;
}

/**
 * Set a widget's text.
 *
 * Applied as a prefix/suffix diff so two people typing in the same note merge
 * character-wise instead of overwriting each other's paragraph. One transaction per
 * call: the editor calls this on every keystroke, and Yjs streams that update.
 */
export function setWidgetText(
  board: BoardDocument,
  id: string,
  value: string,
  options: { height?: number | null } = {},
): void {
  const widget = board.readWidget(id);
  if (!widget || widget.locked) return;

  const sharedText = board.texts.get(id);
  const currentText = sharedText ? plainOf(sharedText) : (widget.title ?? widget.content ?? "");
  const textDiffers = currentText !== value;
  const heightDiffers =
    options.height != null && Math.abs(widget.height - options.height) > 0.5;

  // Nothing to do: do not create a shared text or an undo step for a no-op.
  if (!textDiffers && !heightDiffers) return;

  // Merged: consecutive keystrokes are one undo step, bounded by the editor's own
  // stopCapturing() calls when it opens and closes.
  board.transact(() => {
    // Note-like widgets grow with their text. The caller measures (font metrics
    // need a canvas), and the resize rides along in the same merged transaction so
    // an editing session is still one undo step.
    if (heightDiffers && options.height != null) {
      const live = board.readWidget(id);
      if (live) board.widgets.set(id, { ...live, height: options.height });
    }

    if (!textDiffers) return;

    let text = board.texts.get(id);
    if (!text) {
      text = new Y.Text();
      board.texts.set(id, text);
      if (currentText) text.insert(0, currentText);
    }

    const current = plainOf(text);
    let prefix = 0;
    const maxPrefix = Math.min(current.length, value.length);
    while (prefix < maxPrefix && current[prefix] === value[prefix]) prefix += 1;

    let suffix = 0;
    const maxSuffix = Math.min(current.length - prefix, value.length - prefix);
    while (
      suffix < maxSuffix &&
      current[current.length - 1 - suffix] === value[value.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const removeLength = current.length - prefix - suffix;
    if (removeLength > 0) text.delete(prefix, removeLength);
    const insertValue = value.slice(prefix, value.length - suffix);
    if (insertValue) text.insert(prefix, insertValue);
  }, LOCAL_ORIGIN, { merge: true });
}


export function setNoteFontSize(board: BoardDocument, ids: string[], fontSize: number | null): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || !holdsText(widget)) continue;
      if (widget.locked) continue;
      const style = { ...widget.style };
      if (fontSize == null) delete style.fontSize;
      else style.fontSize = Math.max(6, Math.min(96, Math.round(fontSize)));
      board.widgets.set(id, { ...widget, style });
    }
  });
}

/** Horizontal text alignment inside the note. */
export function setNoteTextAlign(
  board: BoardDocument,
  ids: string[],
  align: "left" | "center" | "right",
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || !holdsText(widget)) continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, textAlign: align } });
    }
  });
}

/** Vertical text alignment inside the note. */
export function setNoteTextVAlign(
  board: BoardDocument,
  ids: string[],
  vAlign: "top" | "middle" | "bottom",
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || !holdsText(widget)) continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, textVAlign: vAlign } });
    }
  });
}

/** Marks that every character of a note carries, or null when they differ. */
export function noteMarksOf(board: BoardDocument, id: string): TextMarks | null {
  const chars: TextMarks[] = [];
  for (const op of board.deltaOf(id)) {
    const marks = op.attributes ?? {};
    for (let i = 0; i < op.insert.length; i += 1) chars.push(marks);
  }
  if (!chars.length) return {};
  const first = chars[0]!;
  for (const marks of chars) {
    for (const key of ["bold", "italic", "underline", "strike"] as const) {
      if (Boolean(first[key]) !== Boolean(marks[key])) return null;
    }
  }
  return { ...first };
}

/**
 * Toggle one mark on the whole note.
 *
 * The toolbar's B/I/U/S act on the note, not on a selection: while the editor is
 * closed there is no caret, and "make this note bold" is what the button means
 * (ADR-027). Inside the editor the same keys still format only the selection.
 */
export function toggleNoteMark(
  board: BoardDocument,
  ids: string[],
  mark: keyof TextMarks,
): void {
  for (const id of ids) {
    if (board.readWidget(id)?.locked) continue;
    const current = noteMarksOf(board, id);
    if (current == null) continue;
    const next: TextMarks = { ...current };
    if (next[mark]) delete next[mark];
    else next[mark] = true;

    const delta: TextDeltaOp[] = board.deltaOf(id).map((op) => {
      const attributes: TextMarks = { ...(op.attributes ?? {}), ...next };
      if (!next.bold) delete attributes.bold;
      if (!next.italic) delete attributes.italic;
      if (!next.underline) delete attributes.underline;
      if (!next.strike) delete attributes.strike;
      return Object.keys(attributes).length
        ? { insert: op.insert, attributes }
        : { insert: op.insert };
    });
    setWidgetDelta(board, id, delta);
  }
}


export function clearContent(board: BoardDocument, ids: readonly string[]): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget) continue;
      if (widget.type === "card") {
        board.widgets.set(id, { ...widget, title: "" });
        const text = board.texts.get(id);
        if (text) text.delete(0, plainOf(text).length);
        continue;
      }
      if (!holdsText(widget)) continue;
      if (board.deltaOf(id).length) setWidgetDelta(board, id, []);
      board.widgets.set(id, { ...widget, content: "", title: "" });
    }
  });
}

