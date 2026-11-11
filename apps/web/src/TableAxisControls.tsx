import { useRef, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import { addAxis, setAxisSize, tableLayoutOf } from "@remo/doc";
import { layoutTable, type Camera, type TableGrid } from "@remo/canvas";
import { clampAxisSize, type Widget } from "@remo/model";
import { Icon } from "@remo/ui";
import { useI18n } from "./i18n";

type AxisKind = "column" | "row";

/** Screen gap between a table edge and its quiet "+ Column" / "+ Row" pills. */
const EDGE_GAP = 8;
/** Half-width of the invisible strip that resizes an axis on a header boundary. */
const HANDLE_HALF = 4;
const KEY_STEP = 8;
const KEY_STEP_LARGE = 40;

interface Drag {
  frameId: string;
  axisId: string;
  kind: AxisKind;
  start: number;
  from: number;
  size: number;
}

/**
 * On-canvas axis actions of a table section (ADR-196, ADR-201; T5, T13).
 *
 * A selected table gets quiet "+ Column" / "+ Row" pills at its right and bottom edges
 * and a small "+" over every header boundary, which inserts an axis there. Every header
 * boundary also carries a resize handle: dragging it sets a manual pixel size, a double
 * click or Delete returns the axis to Auto. They call the same document commands as the
 * header menu and the section panel; this is a second place to reach them, not a second
 * mechanism.
 */
export function TableAxisControls({
  board,
  widgets,
  camera,
  viewport,
  readOnly,
  activeFrameIds,
  onCreated,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  readOnly: boolean;
  /** Tables whose section or axis is selected show their insert controls. */
  activeFrameIds: ReadonlySet<string>;
  onCreated: (frameId: string, axisId: string) => void;
}) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const toScreen = (x: number, y: number) => ({
    left: (x - camera.x) * camera.zoom + viewport.width / 2,
    top: (y - camera.y) * camera.zoom + viewport.height / 2,
  });

  const placeholder = (kind: AxisKind, n: number) =>
    t(kind === "column" ? "section.axis.placeholderColumn" : "section.axis.placeholderRow", {
      n,
    });

  const insert = (frameId: string, kind: AxisKind, beforeId?: string) => {
    const layout = tableLayoutOf(board, frameId);
    if (!layout) return;
    const axes = kind === "column" ? layout.columns : layout.rows;
    const created = addAxis(board, frameId, kind, {
      title: placeholder(kind, axes.length + 1),
      firstTitle: placeholder(kind, 1),
      oppositeTitle: placeholder(kind === "column" ? "row" : "column", 1),
      ...(beforeId ? { beforeId } : {}),
    });
    if (created) onCreated(frameId, created);
  };

  const commitSize = (frameId: string, axisId: string, kind: AxisKind, px: number) => {
    setAxisSize(board, frameId, axisId, clampAxisSize(kind, px));
  };

  const tables: Array<{ frame: Widget; grid: TableGrid }> = [];
  for (const frame of widgets) {
    if (frame.type !== "frame" || frame.locked) continue;
    const grid = layoutTable(frame, widgets);
    if (grid) tables.push({ frame, grid });
  }
  if (readOnly || !tables.length) return null;

  return (
    <div className="table-axis-controls">
      {tables.map(({ frame, grid }) => {
        const active = activeFrameIds.has(frame.id);
        const right = grid.origin.x + grid.width;
        const bottom = grid.origin.y + grid.height;
        const columnPill = toScreen(right, grid.origin.y);
        const rowPill = toScreen(grid.origin.x, bottom);
        return (
          <div key={frame.id}>
            {grid.columns.map((column) => {
              const edge = toScreen(column.x + column.width, grid.origin.y);
              const live =
                drag && drag.frameId === frame.id && drag.axisId === column.axis.id
                  ? drag
                  : null;
              const name = column.axis.title || t("section.axis.untitled");
              return (
                <ResizeHandle
                  key={`w:${column.axis.id}`}
                  kind="column"
                  left={edge.left - HANDLE_HALF}
                  top={edge.top}
                  length={grid.headerHeight * camera.zoom}
                  value={Math.round(column.width)}
                  label={t("section.size.handleColumn", { name })}
                  hint={t("section.size.handleHint")}
                  preview={live ? t("section.size.px", { n: live.size }) : null}
                  onStart={(clientX) => {
                    const next: Drag = {
                      frameId: frame.id,
                      axisId: column.axis.id,
                      kind: "column",
                      start: clientX,
                      from: column.width,
                      size: Math.round(column.width),
                    };
                    dragRef.current = next;
                    setDrag(next);
                  }}
                  onMove={(clientX) => {
                    const current = dragRef.current;
                    if (!current) return;
                    const size = clampAxisSize(
                      "column",
                      current.from + (clientX - current.start) / camera.zoom,
                    );
                    dragRef.current = { ...current, size };
                    setDrag(dragRef.current);
                  }}
                  onEnd={() => {
                    const current = dragRef.current;
                    dragRef.current = null;
                    setDrag(null);
                    if (current && current.size !== Math.round(current.from)) {
                      commitSize(frame.id, column.axis.id, "column", current.size);
                    }
                  }}
                  onStep={(delta) =>
                    commitSize(frame.id, column.axis.id, "column", column.width + delta)
                  }
                  onAuto={() => setAxisSize(board, frame.id, column.axis.id, "auto")}
                />
              );
            })}
            {grid.rows.map((row) => {
              const edge = toScreen(grid.origin.x, row.y + row.height);
              const live =
                drag && drag.frameId === frame.id && drag.axisId === row.axis.id ? drag : null;
              const name = row.axis.title || t("section.axis.untitled");
              return (
                <ResizeHandle
                  key={`h:${row.axis.id}`}
                  kind="row"
                  left={edge.left}
                  top={edge.top - HANDLE_HALF}
                  length={grid.headerWidth * camera.zoom}
                  value={Math.round(row.height)}
                  label={t("section.size.handleRow", { name })}
                  hint={t("section.size.handleHint")}
                  preview={live ? t("section.size.px", { n: live.size }) : null}
                  onStart={(clientY) => {
                    const next: Drag = {
                      frameId: frame.id,
                      axisId: row.axis.id,
                      kind: "row",
                      start: clientY,
                      from: row.height,
                      size: Math.round(row.height),
                    };
                    dragRef.current = next;
                    setDrag(next);
                  }}
                  onMove={(clientY) => {
                    const current = dragRef.current;
                    if (!current) return;
                    const size = clampAxisSize(
                      "row",
                      current.from + (clientY - current.start) / camera.zoom,
                    );
                    dragRef.current = { ...current, size };
                    setDrag(dragRef.current);
                  }}
                  onEnd={() => {
                    const current = dragRef.current;
                    dragRef.current = null;
                    setDrag(null);
                    if (current && current.size !== Math.round(current.from)) {
                      commitSize(frame.id, row.axis.id, "row", current.size);
                    }
                  }}
                  onStep={(delta) => commitSize(frame.id, row.axis.id, "row", row.height + delta)}
                  onAuto={() => setAxisSize(board, frame.id, row.axis.id, "auto")}
                />
              );
            })}

            {drag?.frameId === frame.id && (
              <div
                className={`table-resize-guide is-${drag.kind}`}
                aria-hidden="true"
                style={(() => {
                  if (drag.kind === "column") {
                    const column = grid.columns.find((entry) => entry.axis.id === drag.axisId);
                    const at = toScreen((column?.x ?? 0) + drag.size, grid.origin.y);
                    return { left: at.left, top: at.top, height: grid.height * camera.zoom };
                  }
                  const row = grid.rows.find((entry) => entry.axis.id === drag.axisId);
                  const at = toScreen(grid.origin.x, (row?.y ?? 0) + drag.size);
                  return { left: at.left, top: at.top, width: grid.width * camera.zoom };
                })()}
              />
            )}

            {active && (
              <>
                {grid.columns.slice(1).map((column, index) => {
                  const at = toScreen(column.x, grid.origin.y);
                  const previous = grid.columns[index]!;
                  return (
                    <button
                      key={`ic:${column.axis.id}`}
                      type="button"
                      className="table-insert"
                      style={{ left: at.left, top: at.top - EDGE_GAP - 10 }}
                      aria-label={t("section.edge.insertColumn", {
                        a: previous.axis.title || t("section.axis.untitled"),
                        b: column.axis.title || t("section.axis.untitled"),
                      })}
                      title={t("section.edge.insertColumn", {
                        a: previous.axis.title || t("section.axis.untitled"),
                        b: column.axis.title || t("section.axis.untitled"),
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        insert(frame.id, "column", column.axis.id);
                      }}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  );
                })}
                {grid.rows.slice(1).map((row, index) => {
                  const at = toScreen(grid.origin.x, row.y);
                  const previous = grid.rows[index]!;
                  return (
                    <button
                      key={`ir:${row.axis.id}`}
                      type="button"
                      className="table-insert"
                      style={{ left: at.left - EDGE_GAP - 10, top: at.top }}
                      aria-label={t("section.edge.insertRow", {
                        a: previous.axis.title || t("section.axis.untitled"),
                        b: row.axis.title || t("section.axis.untitled"),
                      })}
                      title={t("section.edge.insertRow", {
                        a: previous.axis.title || t("section.axis.untitled"),
                        b: row.axis.title || t("section.axis.untitled"),
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        insert(frame.id, "row", row.axis.id);
                      }}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="table-edge-add is-column"
                  style={{
                    left: columnPill.left + EDGE_GAP,
                    top: columnPill.top,
                    height: grid.headerHeight * camera.zoom,
                  }}
                  aria-label={t("section.edge.addColumn")}
                  title={t("section.edge.addColumn")}
                  onClick={(event) => {
                    event.stopPropagation();
                    insert(frame.id, "column");
                  }}
                >
                  <Icon name="plus" size={14} />
                  <span>{t("section.axes.addColumn")}</span>
                </button>
                <button
                  type="button"
                  className="table-edge-add is-row"
                  style={{
                    left: rowPill.left,
                    top: rowPill.top + EDGE_GAP,
                    width: grid.headerWidth * camera.zoom,
                  }}
                  aria-label={t("section.edge.addRow")}
                  title={t("section.edge.addRow")}
                  onClick={(event) => {
                    event.stopPropagation();
                    insert(frame.id, "row");
                  }}
                >
                  <Icon name="plus" size={14} />
                  <span>{t("section.axes.addRow")}</span>
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One header boundary: a pointer strip and a keyboard separator in one element, so
 * the person who cannot drag still has the same control (WAI-ARIA window splitter).
 */
function ResizeHandle({
  kind,
  left,
  top,
  length,
  value,
  label,
  hint,
  preview,
  onStart,
  onMove,
  onEnd,
  onStep,
  onAuto,
}: {
  kind: AxisKind;
  left: number;
  top: number;
  length: number;
  value: number;
  label: string;
  hint: string;
  preview: string | null;
  onStart: (at: number) => void;
  onMove: (at: number) => void;
  onEnd: () => void;
  onStep: (delta: number) => void;
  onAuto: () => void;
}) {
  const coordinate = (event: { clientX: number; clientY: number }) =>
    kind === "column" ? event.clientX : event.clientY;
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={kind === "column" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-description={hint}
      aria-valuenow={value}
      title={label}
      className={`table-resize is-${kind}`}
      style={
        kind === "column"
          ? { left, top, width: HANDLE_HALF * 2, height: length }
          : { left, top, height: HANDLE_HALF * 2, width: length }
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart(coordinate(event));
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onMove(coordinate(event));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onEnd();
      }}
      onPointerCancel={() => onEnd()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onAuto();
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        const back = kind === "column" ? "ArrowLeft" : "ArrowUp";
        const forward = kind === "column" ? "ArrowRight" : "ArrowDown";
        if (event.key === back || event.key === forward) {
          event.preventDefault();
          event.stopPropagation();
          onStep(event.key === forward ? step : -step);
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          event.stopPropagation();
          onAuto();
        }
      }}
    >
      {preview && <span className="table-resize-value">{preview}</span>}
    </div>
  );
}
