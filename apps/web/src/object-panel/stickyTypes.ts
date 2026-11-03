import type { ShapePreset, StickySize, TextMarks } from "@remo/model";
import type { NoteDirection } from "@remo/doc";

/**
 * What the object bar shows and what it can do, without the bar itself.
 *
 * The panels for a note, a shape and the shared "customize" popover read these types;
 * keeping them out of `StickyPanel.tsx` lets those files import the contract without
 * importing each other (ADR-124).
 */
export interface StickyBarTarget {
  id: string;
  /** Notes, shapes and free text share this bar; the sample and some controls differ. */
  kind: "note" | "shape" | "text";
  /** Screen-space box of the note. */
  rect: { left: number; top: number; width: number; height: number };
  /** Where the bar itself goes, already clamped to the canvas. */
  placement: { left: number; top: number };
  fillColor?: string;
  /** Explicit text colour; absent means it follows the fill. */
  textColor?: string;
  /** The colour the text actually has right now, explicit or automatic. */
  ink: string;
  /** Shape outline; unused by notes. */
  strokeColor?: string;
  strokeWidth?: number;
  /** Shape outline dash; unused by notes. */
  strokeStyle?: "normal" | "dashed" | "dotted";
  size: StickySize;
  /** Explicit text size, or null for Auto. */
  fontSize: number | null;
  /** Size Auto is currently using, shown next to the word "Auto". */
  autoSize: number;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  marks: TextMarks | null;
  /** Read-only note (a card) gets no property controls. */
  editable: boolean;
}

export interface StickyBarActions {
  setColor: (name: string) => void;
  /** `null` restores the automatic colour that follows the fill. */
  setInk: (color: string | null) => void;
  setStroke: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setStrokeStyle: (style: "normal" | "dashed") => void;
  setSize: (size: StickySize) => void;
  setFont: (size: number | null) => void;
  toggleMark: (mark: keyof TextMarks) => void;
  setAlign: (align: "left" | "center" | "right") => void;
  setVAlign: (vAlign: "top" | "middle" | "bottom") => void;
  addConnected: (direction: NoteDirection) => void;
  /**
   * One chip, one preset, one undo step: the document writes fill, outline and width
   * together, so undo does not have to be pressed three times (ADR-120).
   */
  applyShapePreset: (preset: ShapePreset) => void;
  /** Delete from "More" — the same path as the Delete key, confirmation included. */
  remove: () => void;
}
