import { ANCHOR_GAP, anchorsOf, placementOfCard } from "./canvasGeometry";
import type { ResizeCorner } from "./canvasGeometry";
import type { ConnectDraft, GestureDeps } from "./gestureTypes";
import { connectorPath, isVisible, labelPoint, paintOrder, unionBox, visibleWorldRect } from "@remo/canvas";
import type { AlignmentGuide, Camera, ConnectorHandle, ConnectorPath, SnapTarget } from "@remo/canvas";
import type { WidgetPosition } from "@remo/doc";
import { canConnect } from "@remo/model";
import type { ConnectorSide, Rect, Widget } from "@remo/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DragState =
  | { mode: "pan"; startScreen: { x: number; y: number }; startCamera: Camera }
  | {
      mode: "widget";
      origins: WidgetPosition[];
      start: { x: number; y: number };
      /** Union box of the lifted objects, which is what alignment snaps. */
      box: Rect;
      /** A table cell under the pointer that will take the selection on drop. */
      table?: {
        frameId: string;
        rowId: string;
        columnId: string;
        offset: { x: number; y: number };
      };
      /** The pointer is over a table header: the drop is refused, not free. */
      refused?: boolean;
    }
  | {
      /** A press on an empty cell: a click selects the cell, a drag becomes a marquee. */
      mode: "cellPress";
      start: { x: number; y: number };
      startScreen: { x: number; y: number };
      additive: boolean;
    }
  | {
      mode: "marquee";
      start: { x: number; y: number };
      additive: boolean;
      /** Set when the marquee is drawn inside a kanban: it targets that board's cards. */
      hostId?: string;
    }
  | { mode: "card"; kanbanId: string; cardId: string; offset: { x: number; y: number } }
  | {
      mode: "resize";
      id: string;
      ids: string[];
      corner: ResizeCorner;
      origin: Rect;
      /** The boxes as they were when the gesture started; the preview must not feed itself. */
      members: Array<{
        id: string;
        box: Rect;
        scalable: boolean;
        min: { width: number; height: number };
      }>;
    }
  | { mode: "connect"; fromId: string; fromSide: ConnectorSide }
  | {
      mode: "reattach";
      id: string;
      end: "start" | "end";
      otherItem: string;
      otherSide: ConnectorSide;
    }
  | {
      mode: "connector";
      id: string;
      /** Which handle is held, and what the line looked like when it started. */
      handle: ConnectorHandle["kind"] | "label";
      origin: Widget;
      path: ConnectorPath;
      /** For a bend: the axis it slides on and the two stub coordinates. */
      axis?: "x" | "y";
      from?: number;
      to?: number;
      /** For a corner flip: the corner it would move to. */
      at?: { x: number; y: number };
      alternate?: { x: number; y: number };
      /** For a rigid point, the stored waypoint being moved. */
      waypointId?: string;
      /** For a segment midpoint, the index where the new point is inserted. */
      segment?: number;
    }
  | null;


export function useGestureEnv(deps: GestureDeps) {
  const {
    camera,
    viewport,
    settings,
    widgets,
    layouts,
    selectedIds,
    isCardOfKanban,
    toWorld,
    boardRef,
    worldToScreenPoint,
    onCamera,
    onSelect,
    onMoveMany,
    onResizeMany,
    onMoveCard,
    onMoveToCell,
    onAddCard,
    onConnect,
    onConnectorPatch,
    onAddWaypoint,
    onMoveWaypoint,
    onDeleteWaypoint,
    onLimit,
    onReattachEnd,
    onEdit,
    onCreateConnected,
    onCursor,
    readOnly = false,
  } = deps;

  const dragRef = useRef<DragState>(null);
  /** Live card position: state drives painting, the ref is what commits on drop. */
  const cardPreviewRef = useRef<{ cardId: string; x: number; y: number } | null>(null);
  /** Live connector draft: state paints it, the ref commits the link. */
  const connectDraftRef = useRef<ConnectDraft | null>(null);
  /**
   * Where an anchor press began.
   *
   * A press on an anchor is two gestures: a click adds a connected note, a drag
   * draws a line to another object. The threshold is what tells them apart, so the
   * first few pixels of movement are not enough to cancel the click.
   */
  const anchorPressRef = useRef<{
    fromId: string;
    side: ConnectorSide;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  /** Live marquee rectangle: state paints it, the ref commits the selection. */
  const marqueeRef = useRef<Rect | null>(null);
  /** Live drag offset: the preview paints it, the ref commits the move on drop. */
  const dragDeltaRef = useRef<{ dx: number; dy: number } | null>(null);

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ cardId: string; x: number; y: number } | null>(
    null,
  );
  const [hoverCell, setHoverCell] = useState<{ columnId: string; swimlaneId: string } | null>(
    null,
  );
  const [tableHover, setTableHover] = useState<{
    frameId: string;
    rowId: string;
    columnId: string;
  } | null>(null);
  const [tableRefused, setTableRefused] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /**
   * The gesture in flight, as patches on stored widgets (ADR-051).
   *
   * Dragging writes positions, resizing writes a box, reshaping a line writes its
   * bend or curve. Everything downstream — the painter, hit-testing, connector
   * endpoints, reshape handles — reads this one map, so a preview can never again be
   * drawn in one place and measured in another.
   */
  const [preview, setPreview] = useState<ReadonlyMap<string, Partial<Widget>>>(
    () => new Map(),
  );
  /** The same map for handlers that must not wait for a render. */
  const previewLive = useRef<ReadonlyMap<string, Partial<Widget>>>(new Map());
  /**
   * One preview commit per animation frame (ADR-213).
   *
   * A trackpad or a gaming mouse sends pointer moves faster than the screen refreshes.
   * Repainting the board for every event buys nothing visible and spends the frame
   * budget that the paint itself needs; the last position of the frame is the one a
   * person can actually see. The handlers keep reading `previewLive`, so hit-testing
   * and the drop stay exact, and a release cancels the pending frame before it clears.
   */
  const previewFrame = useRef<number | null>(null);
  const paintPreview = useCallback(() => {
    previewFrame.current = null;
    setPreview(previewLive.current);
  }, []);
  const applyPreview = useCallback(
    (next: ReadonlyMap<string, Partial<Widget>>) => {
      previewLive.current = next;
      if (previewFrame.current !== null) return;
      previewFrame.current = requestAnimationFrame(paintPreview);
    },
    [paintPreview],
  );
  const clearPreview = useCallback(() => {
    if (previewFrame.current !== null) {
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current = null;
    }
    previewLive.current = new Map();
    setPreview(previewLive.current);
  }, []);
  useEffect(
    () => () => {
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    },
    [],
  );

  /** Ids being dragged right now — the "in hand" shadow applies to exactly these. */
  const [dragIds, setDragIds] = useState<string[]>([]);
  /** Roots of the gesture, which are the only ones that leave a ghost behind. */
  const [dragGhostIds, setDragGhostIds] = useState<string[]>([]);
  /** Alignment lines for the current drag; empty when nothing is near enough. */
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  /** The floored block size while a resize is stopped at a minimum (ADR-211). */
  const [resizeLimit, setResizeLimit] = useState<{ width: number; height: number } | null>(null);

  /**
   * Object under the pointer.
   *
   * Connector anchors appear on the hovered note rather than on everything selected:
   * four dots on every selection, on top of the resize handles, is a lot of noise for
   * an affordance that is only useful while you are about to drag from one.
   */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Live connector being dragged from the selection's anchor, if any. */
  const [connectDraft, setConnectDraft] = useState<ConnectDraft | null>(null);
  /** A click on a port with no candidate waits for the next click (ADR-080). */
  const [connectPending, setConnectPending] = useState(false);
  const connectPendingRef = useRef<{
    fromId: string;
    fromSide: ConnectorSide;
  } | null>(null);

  /**
   * The anchor the pointer is over.
   *
   * It is painted filled so the four dots read as four buttons, and a click (without
   * a drag) grows a connected note from that side — the same action as the bar's
   * arrow buttons (ADR-035).
   */
  const [hoverAnchor, setHoverAnchor] = useState<{ id: string; side: ConnectorSide } | null>(
    null,
  );


  const widgetIndex = useMemo(() => {
    const index = new Map<string, Widget>();
    for (const widget of widgets) index.set(widget.id, widget);
    return index;
  }, [widgets]);

  const widgetById = useCallback(
    (id: string) => {
      const widget = widgetIndex.get(id);
      if (!widget) return undefined;
      const card = placementOfCard(layouts, id);
      const placed = card
        ? { ...widget, x: card.x, y: card.y, width: card.width, height: card.height }
        : widget;
      const patch = preview.get(id);
      return patch ? { ...placed, ...patch } : placed;
    },
    [layouts, preview, widgetIndex],
  );

  const alignmentTargets = useCallback(
    (exclude: readonly string[]): SnapTarget[] => {
      const visible = visibleWorldRect(camera, viewport);
      const skip = new Set(exclude);
      const boxes: SnapTarget[] = [];
      const intersects = (box: Rect) =>
        box.x < visible.x + visible.width &&
        box.x + box.width > visible.x &&
        box.y < visible.y + visible.height &&
        box.y + box.height > visible.y;

      for (const widget of widgets) {
        if (skip.has(widget.id)) continue;
        if (widget.type === "connector" || isCardOfKanban(widget)) continue;
        if (!isVisible(widget, visible)) continue;
        boxes.push({
          x: widget.x - widget.width / 2,
          y: widget.y - widget.height / 2,
          width: widget.width,
          height: widget.height,
        });
      }

      for (const layout of layouts.values()) {
        const box = { x: layout.left, y: layout.top, width: layout.width, height: layout.height };
        if (!intersects(box)) continue;
        for (const column of layout.columns) {
          boxes.push({
            x: column.left,
            y: layout.top + layout.headerHeight,
            width: column.width,
            height: layout.height - layout.headerHeight,
            // Grid edges only: a column's centre is where its cards sit, not a line
            // a note should jump to.
            centers: false,
          });
        }
      }

      return boxes;
    },
    [camera, isCardOfKanban, layouts, viewport, widgets],
  );


  /**
   * Connector whose label chip is under the point.
   *
   * The chip is its own grab target: it can sit away from the line on purpose, so
   * "click the text to move the text" has to work without selecting the line first
   * (ADR-043). Measured with the same font the painter uses, because a hit area that
   * does not match the chip is a hit area you have to guess at.
   */
  const connectorLabelAt = useCallback(
    (world: { x: number; y: number }): string | null => {
      const ctx = boardRef.current?.getContext("2d");
      if (!ctx) return null;
      for (const widget of [...paintOrder(widgets)].reverse()) {
        if (widget.type !== "connector") continue;
        const label = widget.content?.trim();
        if (!label) continue;
        const live = widgetById(widget.id) ?? widget;
        const path = connectorPath(live, widgetById, {
          max: settings.connectors.stubMax,
          ratio: settings.connectors.stubRatio,
        });
        if (!path) continue;

        const at = labelPoint(path, live.labelAt);
        const size = live.style?.fontSize ?? 13;
        ctx.font = `500 ${size}px ${settings.text.fontFamily}`;
        const width = ctx.measureText(label).width + size * 0.92;
        const height = size * 1.6;
        if (
          Math.abs(world.x - at.x) <= width / 2 &&
          Math.abs(world.y - at.y) <= height / 2
        ) {
          return widget.id;
        }
      }
      return null;
    },
    [settings.connectors.stubMax, settings.connectors.stubRatio, settings.text.fontFamily, widgetById, widgets],
  );


  /**
   * Start moving a set of objects.
   *
   * The union box is captured once, at the start: that is what alignment snaps, and
   * recomputing it from the moved widgets would feed the snap back into itself.
   */
  const beginWidgetDrag = useCallback(
    (ids: readonly string[], world: { x: number; y: number }) => {
      // A reader selects, pans and reads; nothing is lifted.
      if (readOnly) return;
      // A frame carries its contents, so they move in the preview too — otherwise
      // the frame would slide away and its stickies would wait for the drop.
      const lifted = new Set(ids);
      let grew = true;
      while (grew) {
        grew = false;
        for (const widget of widgets) {
          if (widget.parentId && lifted.has(widget.parentId) && !lifted.has(widget.id)) {
            lifted.add(widget.id);
            grew = true;
          }
        }
      }

      // A locked object travels with the selection: the lock protects what the object
      // is (size, text, links), not where it stands (ADR-210, amending ADR-040).
      const origins = widgets
        .filter((widget) => lifted.has(widget.id) && !isCardOfKanban(widget))
        .map((widget) => ({ id: widget.id, x: widget.x, y: widget.y }));
      if (!origins.length) return;
      const box =
        unionBox(
          origins.map((origin) => {
            const widget = widgetById(origin.id);
            return {
              x: origin.x - (widget?.width ?? 0) / 2,
              y: origin.y - (widget?.height ?? 0) / 2,
              width: widget?.width ?? 0,
              height: widget?.height ?? 0,
            };
          }),
        ) ?? { x: world.x, y: world.y, width: 0, height: 0 };

      dragRef.current = { mode: "widget", origins, start: world, box };
      setDragIds(origins.map((origin) => origin.id));
      setDragGhostIds(origins.filter((origin) => ids.includes(origin.id)).map((origin) => origin.id));
      setGuides([]);
    },
    [isCardOfKanban, readOnly, widgetById, widgets],
  );


  /** The selected object's anchor the pointer is in, if any. */
  const anchorNear = useCallback(
    (world: { x: number; y: number }): { id: string; side: ConnectorSide } | null => {
      if (selectedIds.length !== 1) return null;
      const widget = widgetById(selectedIds[0]!);
      if (!widget || !canConnect(widget)) return null;
      const reach = 13 / camera.zoom;
      const gap = ANCHOR_GAP / camera.zoom;
      for (const anchor of anchorsOf(widget, gap)) {
        if (Math.hypot(anchor.x - world.x, anchor.y - world.y) <= reach) {
          return { id: widget.id, side: anchor.side };
        }
      }
      return null;
    },
    [camera.zoom, selectedIds, widgetById],
  );


  const lastCursorSent = useRef(0);

  const publishCursor = useCallback(
    (world: { x: number; y: number } | null) => {
      const now = Date.now();
      if (world && now - lastCursorSent.current < 40) return;
      lastCursorSent.current = now;
      onCursor(world);
    },
    [onCursor],
  );


  useEffect(() => {
    if (!connectPending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      connectPendingRef.current = null;
      connectDraftRef.current = null;
      setConnectPending(false);
      setConnectDraft(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectPending]);
  return {
    camera,
    viewport,
    settings,
    widgets,
    layouts,
    selectedIds,
    isCardOfKanban,
    toWorld,
    boardRef,
    worldToScreenPoint,
    onCamera,
    onSelect,
    onMoveMany,
    onResizeMany,
    onMoveCard,
    onMoveToCell,
    onAddCard,
    onConnect,
    onConnectorPatch,
    onAddWaypoint,
    onMoveWaypoint,
    onDeleteWaypoint,
    onLimit,
    onReattachEnd,
    onEdit,
    onCreateConnected,
    onCursor,
    readOnly,
    dragRef,
    cardPreviewRef,
    connectDraftRef,
    anchorPressRef,
    marqueeRef,
    dragDeltaRef,
    cursor,
    setCursor,
    dragPreview,
    setDragPreview,
    hoverCell,
    setHoverCell,
    tableHover,
    setTableHover,
    tableRefused,
    setTableRefused,
    marquee,
    setMarquee,
    preview,
    setPreview,
    previewLive,
    applyPreview,
    clearPreview,
    dragIds,
    setDragIds,
    dragGhostIds,
    setDragGhostIds,
    guides,
    resizeLimit,
    setResizeLimit,
    setGuides,
    hoverId,
    setHoverId,
    connectDraft,
    setConnectDraft,
    connectPending,
    setConnectPending,
    connectPendingRef,
    hoverAnchor,
    setHoverAnchor,
    widgetIndex,
    widgetById,
    alignmentTargets,
    connectorLabelAt,
    beginWidgetDrag,
    anchorNear,
    lastCursorSent,
    publishCursor,
  };
}

/**
 * Everything the pointer handlers share: live refs, the state that paints, the derived
 * lookups and the small actions built on them.
 *
 * One object, so each phase of a gesture can be a plain function of (env, event) instead
 * of a closure over two hundred lines of hook scope (ADR-093/Q4.2).
 */
export type GestureEnv = ReturnType<typeof useGestureEnv>;

/** Pointer capture keeps the drag alive outside the canvas. */
export function capture(event: React.PointerEvent<HTMLCanvasElement>): void {
  try {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    /* no active pointer (automation/tests) — drag state is enough */
  }
}
