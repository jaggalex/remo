import { useMemo } from "react";
import type { Camera } from "@remo/canvas";
import type { TextMarks, Widget } from "@remo/model";
import type { ArrangeBarTarget } from "./ArrangeBar";
import type { ConnectorBarTarget } from "./ConnectorBar";
import * as floating from "./floatingTargets";
import type { BoardSettings } from "./settings";
import type { StickyBarTarget } from "./StickyBar";

/**
 * Where the floating bars go, and whether they exist at all.
 *
 * Three bars share one frame (the screen), one rule: a reader gets none of them, because
 * a bar would only offer writes the socket refuses (ADR-062). Positions are computed in
 * screen space so the bar sits on its target at any zoom.
 */
export function useFloatingBars({
  camera,
  viewport,
  settings,
  selectedIds,
  readOnly,
  noteMarks,
  resolve,
}: {
  camera: Camera;
  viewport: { width: number; height: number };
  settings: BoardSettings;
  selectedIds: readonly string[];
  readOnly: boolean;
  noteMarks: (id: string) => TextMarks | null;
  resolve: (id: string) => Widget | undefined;
}): {
  stickyBar: StickyBarTarget | null;
  arrangeBar: ArrangeBarTarget | null;
  connectorBar: ConnectorBarTarget | null;
} {
  /** Screen frame the floating bars are placed in. */
  const frame = useMemo<floating.Frame>(() => ({ camera, viewport }), [camera, viewport]);

  const stickyBar = useMemo<StickyBarTarget | null>(() => {
    if (readOnly) return null;
    if (selectedIds.length !== 1) return null;
    const widget = resolve(selectedIds[0]!);
    if (!widget) return null;
    const marks = noteMarks(widget.id);
    return floating.noteBarTarget({ widget, frame, settings, marks });
  }, [frame, noteMarks, readOnly, selectedIds, settings, resolve]);

  /** The arrange bar's target: two or more selected objects. */
  const arrangeBar = useMemo<ArrangeBarTarget | null>(
    () => (readOnly ? null : floating.arrangeBarTarget({ selectedIds, frame, resolve })),
    [frame, readOnly, selectedIds, resolve],
  );

  /** Where the connector bar goes: just above the selected line's box. */
  const connectorBar = useMemo<ConnectorBarTarget | null>(() => {
    if (readOnly) return null;
    if (selectedIds.length !== 1) return null;
    const widget = resolve(selectedIds[0]!);
    if (!widget) return null;
    return floating.connectorBarTarget({ widget, frame, settings, resolve });
  }, [frame, readOnly, selectedIds, settings, resolve]);

  return { stickyBar, arrangeBar, connectorBar };
}
