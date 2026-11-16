import { useEffect, useRef, useState } from "react";
import { setTableHeaderSize, type BoardDocument } from "@remo/doc";
import type { Camera, TableGrid } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { useI18n } from "./i18n";

/** Screen-pixel hit strip on each side of a band boundary. */
const HIT = 12;
/** The visual and pointer grip at the corner, before it is clamped on a small table. */
const GRIP = 20;
const KEY_STEP = 8;
const KEY_STEP_LARGE = 40;
const HEADER_MIN_HEIGHT = 40;
const HEADER_MAX_HEIGHT = 2000;
const HEADER_MIN_WIDTH = 64;
const HEADER_MAX_WIDTH = 2000;

type Kind = "height" | "width";

interface Drag {
  kind: Kind;
  start: number;
  from: number;
  value: number;
}

/**
 * The corner between the column-header band and the row-name strip (ADR-219).
 *
 * The corner is chrome, not a cell: it has no cell identity, no range and no drop target.
 * Its bottom edge changes the header height, its right edge changes the strip width. The
 * full lines through the table are guides only; the hit areas stay inside the headers, so
 * a click near a cell edge still selects the cell. The 20 px grip sits at the meeting
 * point, double-clicks both sizes to Auto and does nothing on drag.
 */
export function TableBandCorner({
  board,
  frame,
  grid,
  camera,
  viewport,
}: {
  board: BoardDocument;
  frame: Widget;
  grid: TableGrid;
  camera: Camera;
  viewport: { width: number; height: number };
}) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Kind | null>(null);
  const [coarse, setCoarse] = useState(false);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  const toScreen = (x: number, y: number) => ({
    left: (x - camera.x) * camera.zoom + viewport.width / 2,
    top: (y - camera.y) * camera.zoom + viewport.height / 2,
  });

  const corner = toScreen(grid.origin.x, grid.origin.y);
  const band = grid.headerHeight * camera.zoom;
  const strip = grid.headerWidth * camera.zoom;
  const hit = coarse ? 24 : HIT;
  const hHit = Math.min(hit, band);
  const wHit = Math.min(hit, strip);
  const grip = Math.min(GRIP, Math.max(8, Math.min(band - hHit, strip - wHit)));
  const gripLeft = corner.left + strip - grip;
  const gripTop = corner.top + band - grip;
  const lineTop = corner.top + band;
  const lineLeft = corner.left + strip;
  const heightTop = lineTop - hHit;
  const widthLeft = lineLeft - wHit;

  const clamp = (kind: Kind, value: number) =>
    Math.round(
      kind === "height"
        ? Math.min(HEADER_MAX_HEIGHT, Math.max(HEADER_MIN_HEIGHT, value))
        : Math.min(HEADER_MAX_WIDTH, Math.max(HEADER_MIN_WIDTH, value)),
    );

  const begin = (kind: Kind, at: number) => {
    const from = kind === "height" ? grid.headerHeight : grid.headerWidth;
    const next: Drag = { kind, start: at, from, value: Math.round(from) };
    dragRef.current = next;
    setDrag(next);
  };

  const move = (at: number) => {
    const current = dragRef.current;
    if (!current) return;
    const size = clamp(current.kind, current.from + (at - current.start) / camera.zoom);
    dragRef.current = { ...current, value: size };
    setDrag(dragRef.current);
  };

  const end = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || current.value === Math.round(current.from)) return;
    setTableHeaderSize(board, frame.id, current.kind, current.value);
  };

  const auto = (kind: Kind) => setTableHeaderSize(board, frame.id, kind, null);

  const autoBoth = () => {
    board.transact(() => {
      setTableHeaderSize(board, frame.id, "height", null);
      setTableHeaderSize(board, frame.id, "width", null);
    });
  };

  const key = (kind: Kind) => {
    const now = kind === "height" ? grid.headerHeight : grid.headerWidth;
    return {
      style: {
        position: "absolute" as const,
        ...(kind === "height"
          ? { left: corner.left, top: heightTop, width: strip - grip, height: hHit }
          : { left: widthLeft, top: corner.top, width: wHit, height: band - grip }),
      },
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        begin(kind, kind === "height" ? event.clientY : event.clientX);
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        move(kind === "height" ? event.clientY : event.clientX);
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        end();
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setDrag(null);
      },
      onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        auto(kind);
      },
      onPointerEnter: () => setHover(kind),
      onPointerLeave: () => setHover(null),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        const back = kind === "height" ? "ArrowUp" : "ArrowLeft";
        const forward = kind === "height" ? "ArrowDown" : "ArrowRight";
        const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        if (event.key === back || event.key === forward) {
          event.preventDefault();
          setTableHeaderSize(
            board,
            frame.id,
            kind,
            clamp(kind, now + (event.key === forward ? step : -step)),
          );
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          auto(kind);
        }
      },
      role: "separator" as const,
      tabIndex: 0,
      "aria-orientation": kind === "height" ? ("horizontal" as const) : ("vertical" as const),
      "aria-label": t(
        kind === "height" ? "section.size.headerHeight" : "section.size.headerWidth",
      ),
      "aria-description": t("section.size.handleHint"),
      "aria-valuemin": kind === "height" ? HEADER_MIN_HEIGHT : HEADER_MIN_WIDTH,
      "aria-valuemax": kind === "height" ? HEADER_MAX_HEIGHT : HEADER_MAX_WIDTH,
      "aria-valuenow": Math.round(now),
      className: `table-band-segment is-${kind}`,
      title: t(kind === "height" ? "section.size.headerHeight" : "section.size.headerWidth"),
    };
  };

  const guide = drag ?? (hover ? { kind: hover, value: 0, start: 0, from: 0 } : null);

  return (
    <>
      {guide && (
        <div
          className={`table-band-guide is-${guide.kind}`}
          aria-hidden="true"
          style={
            guide.kind === "height"
              ? { left: corner.left, top: lineTop, width: grid.width * camera.zoom }
              : { left: lineLeft, top: corner.top, height: grid.height * camera.zoom }
          }
        />
      )}
      <div {...key("height")} />
      <div {...key("width")} />
      <div
        className="table-band-grip"
        aria-hidden="true"
        title={t("section.size.headerAutoHint")}
        style={{ left: gripLeft, top: gripTop, width: grip, height: grip }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          autoBoth();
        }}
      >
        <span className="table-band-grip-mark" />
      </div>
      {drag && (
        <div
          className={`table-band-chip is-${drag.kind}`}
          style={
            drag.kind === "height"
              ? { left: corner.left + strip / 2, top: lineTop - 30 }
              : { left: lineLeft + 22, top: corner.top + band / 2 }
          }
        >
          {t(
            drag.kind === "height" ? "section.size.headerHeight" : "section.size.headerWidth",
          )}{" "}
          · {t("section.size.px", { n: drag.value })}
        </div>
      )}
    </>
  );
}
