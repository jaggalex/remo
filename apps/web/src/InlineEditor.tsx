import { useEffect, useRef, useState } from "react";
import type { TextDeltaOp } from "@remo/model";
import type { NoteDirection } from "@remo/doc";
import { useI18n } from "./i18n";
import { deltaFromDom, deltaText, deltaToHtml, placeCaretAtEnd, toggleMark } from "./richText";
import { DEFAULT_EDITOR_SURFACE, DEFAULT_INK } from "./objectDefaults";

export interface EditorTarget {
  id: string;
  /** Screen-space box, so the editor sits exactly over the object. */
  rect: { left: number; top: number; width: number; height: number };
  /** Formatted text the editor opens with; marks are per character. */
  delta: TextDeltaOp[];
  /** Font size in screen pixels (already scaled by zoom). */
  fontSize: number;
  /** Inner padding in screen pixels, matching what the painter draws. */
  padding: number;
  align: "left" | "center" | "right";
  /** Vertical placement, like a sticky note; cards keep text at the top. */
  vAlign: "top" | "middle" | "bottom";
  fontWeight?: number;
  /**
   * Background under the text.
   *
   * The object's own fill, not white: typing on a pale yellow note inside a white
   * box hides the text you are about to write in the colour it will be painted
   * (ADR-038).
   */
  fill?: string;
  /** Text colour, the same one the painter uses. */
  ink?: string;
  /** Radius, so the editor's corners match the object it covers. */
  radius?: number;
}

/**
 * Inline rich-text editor.
 *
 * A `contentEditable` element over the canvas, because real text input needs a real
 * input element and formatting needs a real selection. Every input event goes
 * straight into the shared document as a delta (the source product writes the title
 * per keystroke — ADR-016), so remote participants see typing
 * as it happens rather than on blur, and the painter draws exactly what is here.
 */
export function InlineEditor({
  target,
  onChange,
  onCreateConnected,
  onClose,
}: {
  target: EditorTarget | null;
  onChange: (id: string, delta: TextDeltaOp[]) => void;
  /** Tab / Shift+Tab / Alt+Enter / Alt+Shift+Enter grow a chain of notes. */
  onCreateConnected?: (id: string, direction: NoteDirection) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [mountedFor, setMountedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setMountedFor(null);
      return;
    }
    const node = ref.current;
    if (!node) return;

    if (mountedFor !== target.id) {
      setMountedFor(target.id);
      node.innerHTML = deltaToHtml(target.delta);
      node.focus();
      placeCaretAtEnd(node);
      return;
    }

    // A remote edit while the editor is open: rewrite the DOM only when the text
    // actually differs, so the local caret is never disturbed by our own keystrokes
    // coming back through the document.
    const domDelta = deltaFromDom(node);
    if (deltaText(domDelta) !== deltaText(target.delta)) {
      node.innerHTML = deltaToHtml(target.delta);
      placeCaretAtEnd(node);
    }
  }, [mountedFor, target]);

  if (!target) return null;

  const { rect, fontSize, padding, align, vAlign, fontWeight, fill, ink, radius } = target;

  const commit = () => {
    const node = ref.current;
    if (!node) return;
    onChange(target.id, deltaFromDom(node));
  };

  return (
    <div
      className="inline-editor"
      contentEditable
      suppressContentEditableWarning
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={t("canvas.editText")}
      spellCheck={false}
      dir="auto"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        fontSize,
        fontWeight,
        textAlign: align,
        // Matches the painted metrics (line height is 1.25 of the font) so the caret
        // sits where the drawn text is.
        lineHeight: 1.25,
        padding,
        justifyContent: vAlign === "top" ? "flex-start" : vAlign === "bottom" ? "flex-end" : "center",
        background: fill ?? DEFAULT_EDITOR_SURFACE,
        color: ink ?? DEFAULT_INK,
        borderRadius: radius ?? 3,
      }}
      onInput={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
          event.preventDefault();
          onClose();
          return;
        }

        // Tab grows the chain to the right, Shift+Tab to the left; Alt+Enter puts the
        // next note below, Alt+Shift+Enter above. Enter alone stays a newline, which
        // is what makes a note multi-line (ADR-028).
        if (event.key === "Tab") {
          event.preventDefault();
          commit();
          onCreateConnected?.(target.id, event.shiftKey ? "left" : "right");
          return;
        }
        if (event.key === "Enter" && event.altKey) {
          event.preventDefault();
          commit();
          onCreateConnected?.(target.id, event.shiftKey ? "up" : "down");
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          const key = event.key.toLowerCase();
          if (key === "b" || key === "i" || key === "u") {
            event.preventDefault();
            toggleMark(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
            commit();
            return;
          }
        }
        // Keep canvas shortcuts (undo/redo/delete) out of the text field.
        event.stopPropagation();
      }}
      onBlur={onClose}
    />
  );
}
