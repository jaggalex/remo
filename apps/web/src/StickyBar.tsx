import type { TextMarks } from "@remo/model";
import {
  StickyPanel,
  type StickyBarActions,
  type StickyBarTarget,
} from "./object-panel/StickyPanel";

export type { StickyBarActions, StickyBarTarget };

/**
 * The note bar's entry point.
 *
 * The behaviour moved to `object-panel/StickyPanel.tsx` when the object panels were
 * split into a shared frame and per-object content (ADR-124). This file keeps the name
 * and the props the canvas already uses, so the split changes no caller.
 */
export function StickyBar({
  target,
  actions,
  editing,
  formatSelection,
}: {
  target: StickyBarTarget | null;
  actions: StickyBarActions;
  /** While the note is open for typing, marks apply to the selection, not the note. */
  editing: boolean;
  formatSelection: (mark: keyof TextMarks) => void;
}) {
  return (
    <StickyPanel
      target={target}
      actions={actions}
      editing={editing}
      formatSelection={formatSelection}
    />
  );
}
