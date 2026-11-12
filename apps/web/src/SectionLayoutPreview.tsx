import { layoutTable, tableReflow, type Widget } from "@remo/model";
import type { Camera } from "@remo/canvas";
import type { SectionTablePlan } from "@remo/doc";

/**
 * The live preview of the T4 plan (ADR-207).
 *
 * The cells and the ghost objects come from the same pure `layoutTable`/`tableReflow`
 * pair the command settles with, so the picture and the result cannot disagree.
 */
export function SectionLayoutPreview({
  frame,
  widgets,
  plan,
  camera,
  viewport,
}: {
  frame: Widget;
  widgets: Widget[];
  plan: SectionTablePlan;
  camera: Camera;
  viewport: { width: number; height: number };
}) {
  const assigned = new Map(plan.cells.map((entry) => [entry.id, entry.cell]));
  const tempWidgets = widgets.map((widget) => {
    const cell = assigned.get(widget.id);
    return cell ? { ...widget, parentId: frame.id, cell } : widget;
  });
  const tempFrame = { ...frame, layout: plan.layout };
  const grid = layoutTable(tempFrame, tempWidgets);
  if (!grid) return null;
  const reflow = tableReflow(tempFrame, tempWidgets);
  const moves = new Map((reflow?.moves ?? []).map((move) => [move.id, move]));
  const toScreen = (x: number, y: number, width: number, height: number) => ({
    left: (x - camera.x) * camera.zoom + viewport.width / 2,
    top: (y - camera.y) * camera.zoom + viewport.height / 2,
    width: width * camera.zoom,
    height: height * camera.zoom,
  });

  return (
    <div className="section-layout-preview" aria-hidden="true">
      {grid.cells.map((cell) => {
        const rect = toScreen(
          cell.rect.x,
          cell.rect.y,
          cell.rect.width,
          cell.rect.height,
        );
        return (
          <div
            key={`${cell.rowId}:${cell.columnId}`}
            className="section-layout-cell"
            style={rect}
          />
        );
      })}
      {plan.cells.map((entry) => {
        const widget = widgets.find((candidate) => candidate.id === entry.id);
        if (!widget) return null;
        const move = moves.get(entry.id);
        const x = (move?.x ?? widget.x) - widget.width / 2;
        const y = (move?.y ?? widget.y) - widget.height / 2;
        return (
          <div
            key={entry.id}
            className="section-layout-ghost"
            style={toScreen(x, y, widget.width, widget.height)}
          />
        );
      })}
    </div>
  );
}
