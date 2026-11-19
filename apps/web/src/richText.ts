import { normalizeDelta } from "@remo/doc";
import type { TextDeltaOp, TextMarks } from "@remo/model";

/**
 * Rich text between the DOM and the document.
 *
 * The editor is a `contentEditable` element, so the browser owns the caret and the
 * selection; the document only ever sees a delta. These two functions are the only
 * place that knows about that boundary, which keeps the parsing honest: what the
 * painter draws comes from the delta, and the delta comes from exactly the marks
 * below — nothing else in the DOM can leak into a note.
 */

const MARK_TAGS: ReadonlyArray<readonly [keyof TextMarks, string]> = [
  ["bold", "b"],
  ["italic", "i"],
  ["underline", "u"],
  ["strike", "s"],
];

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Delta to the HTML the editor is seeded with. Newlines become `<br>`. */
export function deltaToHtml(delta: readonly TextDeltaOp[]): string {
  let html = "";
  for (const op of delta) {
    if (!op.insert) continue;
    const text = escapeHtml(op.insert).replace(/\r?\n/g, "<br>");
    const marks = op.attributes ?? {};
    let open = "";
    let close = "";
    for (const [mark, tag] of MARK_TAGS) {
      if (marks[mark]) {
        open += `<${tag}>`;
        close = `</${tag}>${close}`;
      }
    }
    html += `${open}${text}${close}`;
  }
  return html;
}

/** Plain text of a delta — what the note's height and the presence label use. */
export function deltaText(delta: readonly TextDeltaOp[]): string {
  return delta.map((op) => op.insert).join("");
}

function push(out: TextDeltaOp[], text: string, marks: TextMarks): void {
  if (!text) return;
  out.push(Object.keys(marks).length ? { insert: text, attributes: { ...marks } } : { insert: text });
}

function marksFromStyle(element: HTMLElement, marks: TextMarks): TextMarks {
  const next: TextMarks = { ...marks };
  const style = element.style;
  if (!style) return next;
  const weight = style.fontWeight;
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) next.bold = true;
  if (style.fontStyle === "italic" || style.fontStyle === "oblique") next.italic = true;
  const decoration = `${style.textDecoration} ${style.textDecorationLine}`;
  if (decoration.includes("underline")) next.underline = true;
  if (decoration.includes("line-through")) next.strike = true;
  return next;
}

/** Delta of what is currently in the editor's DOM. */
export function deltaFromDom(root: Node): TextDeltaOp[] {
  const out: TextDeltaOp[] = [];

  const walk = (node: Node, marks: TextMarks): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Zero-width characters are a caret artefact of `contentEditable`.
      push(out, (node.nodeValue ?? "").replace(/\u200b/g, ""), marks);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (tag === "br") {
      push(out, "\n", {});
      return;
    }

    let next = marksFromStyle(element, marks);
    if (tag === "b" || tag === "strong") next = { ...next, bold: true };
    if (tag === "i" || tag === "em") next = { ...next, italic: true };
    if (tag === "u") next = { ...next, underline: true };
    if (tag === "s" || tag === "strike" || tag === "del") next = { ...next, strike: true };

    // A block element is a line: the browser produces one per Enter. A newline
    // before every block except the first is exactly the note's text.
    const block = tag === "div" || tag === "p";
    if (block && out.length) push(out, "\n", {});

    for (const child of Array.from(element.childNodes)) walk(child, next);
  };

  for (const child of Array.from(root.childNodes)) walk(child, {});
  return normalizeDelta(out);
}

/** Put the caret after everything, so opening the editor does not destroy text. */
export function placeCaretAtEnd(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Apply a mark to the current selection, the way the toolbar buttons do. */
export function toggleMark(mark: keyof TextMarks): void {
  const command =
    mark === "bold"
      ? "bold"
      : mark === "italic"
        ? "italic"
        : mark === "underline"
          ? "underline"
          : "strikeThrough";
  try {
    document.execCommand(command);
  } catch {
    // An engine without execCommand simply has no toolbar formatting; typing and
    // the document are unaffected.
  }
}
