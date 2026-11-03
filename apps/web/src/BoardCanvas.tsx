import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boxOf,
  connectorPath,
  pathPolyline,
  fitToBounds,
  layoutKanban,
  screenToWorld,
  unionBox,
  visibleWorldRect,
  zoomAt,
  type Camera,
  type KanbanLayout,
} from "@remo/canvas";
import type {
  BoardConnection,
  BoardDocument,
  ConnectorPatch,
  NoteDirection,
  Presence,
} from "@remo/doc";
import {
  soleSelectedGroup,
  type Tag,
  type ConnectorSide,
  type KanbanState,
  type TextDeltaOp,
  type TextMarks,
  type Widget,
} from "@remo/model";
import { InlineEditor } from "./InlineEditor";
import { useGestures } from "./useGestures";
import { useCanvasPainting } from "./useCanvasPainting";
import { useCanvasProbe } from "./useCanvasProbe";
import { CanvasHud } from "./CanvasHud";
import { CanvasHint } from "./CanvasHint";
import { SelectionBadge } from "./SelectionBadge";
import { PresentationLayer } from "./PresentationLayer";
import { SocialLayer } from "./SocialLayer";
import { VoteLayer } from "./VoteLayer";
import type { VoteSession } from "./api";
import { useFloatingBars } from "./useFloatingBars";
import { isEditable } from "./editable";

export { isEditable };
import { contextTargetAt, type ContextTarget } from "./canvasTargets";
import { editorTargetFor } from "./editorTarget";
import { ConnectorBar, type ConnectorBarActions } from "./ConnectorBar";
import { StickyBar, type StickyBarActions } from "./StickyBar";
import { ArrangeBar, type ArrangeBarActions } from "./ArrangeBar";
import { useI18n } from "./i18n";
import { toggleMark as toggleMarkInDom } from "./richText";
import type { BoardSettings } from "./settings";

/** Background grid style. A view preference, not a document property. */
export type GridStyle = "off" | "lines" | "dots";

export interface WidgetPosition {
  id: string;
  x: number;
  y: number;
}

interface Props {
  /** Board name from the document, exposed to the dev probe. */
  boardTitle: string;
  board: BoardDocument;
  connection: BoardConnection | null;
  canFacilitate: boolean;
  meId: string | null;
  canComment: boolean;
  canManage: boolean;
  /** A counter from the rail: start comment placement (ADR-119). */
  commentRequest: number;
  widgets: Widget[];
  /** groupId → name, painted above a named cluster (ADR-101). */
  groupNames: Record<string, string>;
  /** Board tag vocabulary, used by the selection badge (ADR-102). */
  tags: Record<string, Tag>;
  kanbanStates: Record<string, KanbanState>;
  selectedIds: readonly string[];
  onSelect: (ids: string[]) => void;
  onMoveMany: (positions: WidgetPosition[]) => void;
  /** Commit a resize gesture: one transaction, one undo step. */
  onResize: (rect: { id: string; x: number; y: number; width: number; height: number }) => void;
  onMoveCard: (kanbanId: string, cardId: string, columnId: string, swimlaneId: string) => void;
  onAddCard: (kanbanId: string, columnId: string, swimlaneId: string) => void;
  onAddColumn: (kanbanId: string) => void;
  /** Join two objects; the canvas starts this from the selection's anchor. */
  onConnect: (
    fromId: string,
    toId: string,
    sides: { startSide: ConnectorSide; endSide: ConnectorSide },
  ) => string | null;
  camera: Camera;
  onCamera: (camera: Camera) => void;
  /** Who else is in the room; only their cursors are drawn (never our own). */
  presence: Presence[];
  onCursor: (cursor: { x: number; y: number } | null) => void;
  /** Right-click on a kanban header or a card; coordinates are client-space. */
  onContextMenu: (
    target: ContextTarget,
    point: { x: number; y: number; world: { x: number; y: number } },
  ) => void;
  /** Text of every widget, so the inline editor opens with the current value. */
  textOf: (id: string) => string;
  /** Formatted text of a widget, for the editor's initial content. */
  deltaOf: (id: string) => TextDeltaOp[];
  onSetText: (id: string, delta: TextDeltaOp[]) => void;
  /** Note properties shown in the floating bar, and what each control does. */
  stickyActions: StickyBarActions;
  /** Marks common to the whole note, or null when they differ. */
  noteMarks: (id: string) => TextMarks | null;
  /** Auto-create a connected note beside `id` and start editing it. */
  onCreateConnected: (id: string, direction: NoteDirection) => void;
  /** Connector properties shown when a line is selected. */
  connectorActions: ConnectorBarActions;
  /** Arrange the multi-selection: six edges, two distributions, grouping and More. */
  arrangeActions: ArrangeBarActions;
  /** Commit a reshaped line (bend, curve or label position) as one undo step. */
  onConnectorPatch: (id: string, patch: ConnectorPatch) => void;
  /** ADR-077 waypoint commands: one gesture, one undo entry. */
  onAddWaypoint: (id: string, x: number, y: number, index?: number) => boolean;
  onMoveWaypoint: (id: string, waypointId: string, x: number, y: number) => void;
  onDeleteWaypoint: (id: string, waypointId: string) => void;
  onLimit: () => void;
  onReattachEnd: (
    id: string,
    end: "start" | "end",
    item: string,
    side?: ConnectorSide,
  ) => void;
  /** Point walked with the keyboard; painted with a focus ring. */
  focusedWaypoint: { connectorId: string; waypointId: string } | null;
  /** Widget being edited; owned by the app so a toolbar button can trigger it. */
  editingId: string | null;
  onEdit: (id: string | null) => void;
  /** Changes whenever a new template is loaded; used to fit once per load. */
  fitKey: string;
  /** Background grid: a view preference, never part of the document. */
  grid: GridStyle;
  /** The bottom-centre hint may be shown: no voting line owns that slot. */
  hintAllowed: boolean;
  /** Grid step, snap distance, fonts and other tunables (ADR-032). */
  settings: BoardSettings;
  /** A viewer or a public link: selection and panning work, writing does not. */
  readOnly?: boolean;
  /** The open voting session, painted on the objects it covers (ADR-115). */
  voteSession: VoteSession | null;
  voteBusy: boolean;
  voteOffset: number;
  /** The shared timer's deadline while it runs; a pinned session ends with it (ADR-117). */
  voteTimerEndsAt: string | null;
  onVote: (objectId: string) => void;
  onWithdrawVote: (objectId: string) => void;
  onOpenVote: () => void;
  /** Presentation, discussion and reactions are opened from the header (spec §10, П1). */
  presentationOpen: boolean;
  onPresentationOpen: (value: boolean) => void;
  commentsOpen: boolean;
  onCommentsOpen: (value: boolean) => void;
  onCommentsUnread: (value: number) => void;
  reactionRequest: { emoji: string; at: number } | null;
}

/** What the pointer was over when the context menu was requested. */
export type { ContextTarget } from "./canvasTargets";

/**
 * The board is painted on two canvases.
 *
 * The expensive layer (frames, stickies, cards, kanban matrices, selection) is only
 * repainted when the document, the camera or the selection actually change. Cursors,
 * the marquee and the drag ghost live on the overlay, so remote cursors moving at
 * ~25 Hz cost one cheap repaint instead of re-rendering the whole board.
 */
export function BoardCanvas({
  boardTitle,
  board,
  connection,
  canFacilitate,
  meId,
  canComment,
  canManage,
  commentRequest,
  widgets,
  groupNames,
  tags,
  kanbanStates,
  selectedIds,
  onSelect,
  onMoveMany,
  onResize,
  onMoveCard,
  onAddCard,
  onAddColumn,
  onConnect,
  camera,
  onCamera,
  presence,
  onCursor,
  onContextMenu,
  textOf,
  deltaOf,
  onSetText,
  stickyActions,
  noteMarks,
  onCreateConnected,
  connectorActions,
  arrangeActions,
  onConnectorPatch,
  onAddWaypoint,
  onDeleteWaypoint,
  onLimit,
  onMoveWaypoint,
  onReattachEnd,
  focusedWaypoint,
  editingId,
  onEdit,
  fitKey,
  grid,
  hintAllowed,
  settings,
  readOnly = false,
  voteSession,
  voteBusy,
  voteOffset,
  voteTimerEndsAt,
  onVote,
  onWithdrawVote,
  onOpenVote,
  presentationOpen,
  onPresentationOpen,
  commentsOpen,
  onCommentsOpen,
  onCommentsUnread,
  reactionRequest,
}: Props) {
  const { t } = useI18n();
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const boardRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** One layout per kanban, shared by painting and hit-testing. */
  const layouts = useMemo(() => {
    const map = new Map<string, KanbanLayout>();
    for (const widget of widgets) {
      if (widget.type !== "kanban") continue;
      const state = kanbanStates[widget.id];
      if (!state) continue;
      const cards = widgets.filter((w) => w.parentId === widget.id);
      map.set(widget.id, layoutKanban(widget, cards, state));
    }
    return map;
  }, [kanbanStates, widgets]);

  /**
   * Geometry of a widget, with kanban cards resolved to their cell.
   *
   * A card stores no coordinates of its own (`x`/`y` are null in the source data;
   * its place comes from the matrix, ADR-006), so anything that needs a card's box —
   * connector endpoints and the connector anchor — has to read it from the layout.
   * Without this a card's box is at the canvas origin and both the anchor and any
   * line to it would be drawn in the wrong place.
   */
  const cardTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const widget of widgets) {
      if (widget.type === "card") map.set(widget.id, widget.title ?? widget.content ?? "");
    }
    return map;
  }, [widgets]);

  const isCardOfKanban = useCallback(
    (widget: Widget) => widget.type === "card" && !!widget.parentId && layouts.has(widget.parentId),
    [layouts],
  );

  const gestures = useGestures({
    camera,
    viewport,
    settings,
    widgets,
    layouts,
    selectedIds,
    isCardOfKanban,
    toWorld: (event) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToWorld(
        camera,
        { x: 0, y: 0, width: rect.width, height: rect.height },
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
    },
    boardRef,
    worldToScreenPoint: (point) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (point.x - camera.x) * camera.zoom + rect.width / 2 + rect.left,
        y: (point.y - camera.y) * camera.zoom + rect.height / 2 + rect.top,
      };
    },
    onCamera,
    onSelect,
    onMoveMany,
    onResize,
    onMoveCard,
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
  });

  const {
    cursor,
    connectDraft,
    hoverAnchor,
    resolve: widgetById,
    clearHover,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
  } = gestures;

  /* ------------------------------------------------------------- painting -- */

  const { paintStats } = useCanvasPainting({
    boardRef,
    overlayRef,
    viewport,
    camera,
    settings,
    grid,
    widgets,
    layouts,
    cardTitles,
    groupNames,
    selectedIds,
    gestures,
    isCardOfKanban,
    presence,
    editingId,
    focusedWaypoint,
    kanbanStates,
    t,
  });

  // A zero-sized viewport means the wrapper has not been laid out yet (a hidden tab,
  // a first paint before fonts): measure again once it has a size.
  useEffect(() => {
    if (viewport.width > 1 && viewport.height > 1) return;
    const timer = window.setTimeout(() => measure(), 60);
    return () => window.clearTimeout(timer);
  }, [viewport.height, viewport.width]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    setViewport((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);


;

  useCanvasProbe({
    boardTitle,
    camera,
    viewport,
    layouts,
    presence,
    selectedIds,
    connectDraft,
    widgets,
    textOf,
    isCardOfKanban,
    boardRef,
    paintStats,
  });

  const toWorld = (event: { clientX: number; clientY: number }) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld(
      camera,
      { x: 0, y: 0, width: rect.width, height: rect.height },
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
    );
  };

  /**
   * Resolve a right-click to the smallest actionable thing under the cursor:
   * a card wins over its column, a header band wins over the board body.
   */
  const resolveContextTarget = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ): ContextTarget =>
    contextTargetAt({
      world: toWorld(event),
      widgets,
      layouts,
      selectedIds,
      isCardOfKanban,
      resolve: widgetById,
      connector: {
        tolerance: 8 / camera.zoom,
        stubMax: settings.connectors.stubMax,
        stubRatio: settings.connectors.stubRatio,
      },
    });

  const editorTarget = useMemo(() => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return editorTargetFor({
      editingId,
      widgets,
      layouts,
      camera,
      settings,
      deltaOf,
      widgetById,
      rect,
    });
  }, [camera, deltaOf, editingId, layouts, settings, widgetById, widgets]);

  /**
   * Keep the note being edited on screen.
   *
   * A chain grown with Tab walks off the right edge after a few notes, and the editor
   * would open outside the viewport. Centring the camera on the note keeps the flow
   * going without the person having to pan.
   */
  const centredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!editingId) return;
    // Once per editing session: panning while a note is open must not snap back.
    if (centredFor.current === editingId) return;
    const widget = widgets.find((w) => w.id === editingId);
    if (!widget) return;
    const visible = visibleWorldRect(camera, viewport);
    const margin = 40 / camera.zoom;
    const left = widget.x - widget.width / 2;
    const top = widget.y - widget.height / 2;
    const inside =
      left >= visible.x + margin &&
      top >= visible.y + margin &&
      left + widget.width <= visible.x + visible.width - margin &&
      top + widget.height <= visible.y + visible.height - margin;
    centredFor.current = editingId;
    if (!inside) onCamera({ ...camera, x: widget.x, y: widget.y });
  }, [camera, editingId, onCamera, viewport, widgets]);

  /**
   * Latest camera and setter, so the native wheel listener below can stay
   * registered for the life of the canvas instead of being torn down on every pan.
   */
  const cameraRef = useRef(camera);
  const onCameraRef = useRef(onCamera);
  useEffect(() => {
    cameraRef.current = camera;
    onCameraRef.current = onCamera;
  }, [camera, onCamera]);

  /**
   * Wheel and pinch are handled by a native listener, not by React's `onWheel`.
   *
   * React registers `wheel` as passive, so `preventDefault()` inside an `onWheel`
   * handler is ignored and the browser is free to zoom the page instead. That is the
   * instability the owner saw: after the page itself is zoomed, the canvas no longer
   * matches pointer coordinates and the board seems to stop responding. Only a
   * `passive: false` listener can claim the gesture.
   *
   *  - two-finger scroll pans the board (a plain wheel), as in the source product;
   *  - a pinch (reported as `ctrlKey` + wheel) or ⌘/Ctrl + scroll zooms around the
   *    pointer.
   */
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const current = cameraRef.current;
      // Firefox reports line-based deltas; normalise everything to pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;

      // Advance the ref before React re-renders: trackpad momentum sends events
      // faster than a commit, and reading the stale camera would drop deltas.
      if (!(event.ctrlKey || event.metaKey)) {
        const next = {
          ...current,
          x: current.x + dx / current.zoom,
          y: current.y + dy / current.zoom,
        };
        cameraRef.current = next;
        onCameraRef.current(next);
        return;
      }

      // A pinch arrives as many small deltas, Ctrl+wheel as one large one. Clamping
      // the factor keeps both usable without a visible jump.
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-dy * 0.005)));
      const next = zoomAt(
        current,
        { x: 0, y: 0, width: rect.width, height: rect.height },
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        factor,
      );
      cameraRef.current = next;
      onCameraRef.current(next);
    };

    // Safari also reports a trackpad pinch as gesture events; cancelling them stops
    // the page from zooming even when no wheel reaches us.
    const blockGesture = (event: Event) => event.preventDefault();

    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    canvas.addEventListener("gesturestart", blockGesture);
    canvas.addEventListener("gesturechange", blockGesture);
    return () => {
      canvas.removeEventListener("wheel", onWheelNative);
      canvas.removeEventListener("gesturestart", blockGesture);
      canvas.removeEventListener("gesturechange", blockGesture);
    };
  }, []);

  const fit = useCallback(() => {
    if (!viewport.width || !viewport.height) return;
    // Fit what the person is looking at: a selection if there is one, the whole
    // board otherwise. `widgetById` resolves a card to its cell, so a kanban's cards
    // are not measured at the origin they do not occupy.
    const ids = selectedIds.length ? [...selectedIds] : widgets.map((widget) => widget.id);
    const boxes = ids
      .map((id) => widgetById(id))
      .filter((widget): widget is Widget => Boolean(widget))
      .map((widget) => boxOf(widget));
    const target = unionBox(boxes);
    if (target) onCamera(fitToBounds(target, { x: 0, y: 0, ...viewport }));
  }, [onCamera, selectedIds, viewport, widgetById, widgets]);

  /** Zoom around the middle of the canvas, for the two HUD buttons. */
  const zoomBy = useCallback(
    (factor: number) => {
      onCamera(
        zoomAt(
          camera,
          { x: 0, y: 0, width: viewport.width, height: viewport.height },
          { x: viewport.width / 2, y: viewport.height / 2 },
          factor,
        ),
      );
    },
    [camera, onCamera, viewport.height, viewport.width],
  );

  const fittedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!widgets.length) return;
    if (viewport.width <= 1 || viewport.height <= 1) return;
    const key = `${fitKey}@${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  }, [fit, fitKey, viewport.height, viewport.width, widgets.length]);

  const worldCursor = cursor ? toWorld({ clientX: cursor.x, clientY: cursor.y }) : null;
  const selectedKanbanId = selectedIds.find((id) => kanbanStates[id]);
  const selectedKanban = selectedKanbanId ? kanbanStates[selectedKanbanId] : undefined;
  const selectedWidget =
    selectedIds.length === 1 ? widgets.find((w) => w.id === selectedIds[0]) : undefined;

  /**
   * Size of the selected line as it is drawn, not as it was stored.
   *
   * A connector's box is a leftover of its creation: moving an endpoint changes the
   * path without rewriting it, so the badge used to report the shape of a line that no
   * longer exists.
   */
  const selectedLineSize = useMemo(() => {
    if (!selectedWidget || selectedWidget.type !== "connector") return null;
    const path = connectorPath(selectedWidget, widgetById, {
      max: settings.connectors.stubMax,
      ratio: settings.connectors.stubRatio,
    });
    if (!path) return null;
    const points = pathPolyline(path);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      width: Math.round(Math.max(...xs) - Math.min(...xs)),
      height: Math.round(Math.max(...ys) - Math.min(...ys)),
    };
  }, [selectedWidget, settings.connectors.stubMax, settings.connectors.stubRatio, widgetById]);
  const selectedGroup = soleSelectedGroup(widgets, selectedIds);

  /**
   * The note toolbar's target: one note, in screen coordinates.
   *
   * It hides while the inline editor is open — the formatting toolbar of the editor
   * is already there, and two rows of controls above the same note would fight.
   */
  const { stickyBar, arrangeBar, connectorBar } = useFloatingBars({
    camera,
    viewport,
    settings,
    selectedIds,
    readOnly,
    noteMarks,
    resolve: widgetById,
  });

  /** Format the selection inside the open editor, the way its old toolbar did. */
  const formatSelection = useCallback((mark: keyof TextMarks) => {
    toggleMarkInDom(mark);
    const node = document.querySelector<HTMLElement>(".inline-editor");
    if (node) node.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={boardRef} className="layer board" />
      <canvas
        ref={overlayRef}
        className="layer overlay"
        style={hoverAnchor ? { cursor: "crosshair" } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          onCursor(null);
          clearHover();
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(resolveContextTarget(event), {
            x: event.clientX,
            y: event.clientY,
            world: toWorld(event),
          });
        }}
      />
      <CanvasHud
        camera={camera}
        worldCursor={worldCursor}
        onFit={fit}
        onZoom={zoomBy}
      />
      <CanvasHint allowed={hintAllowed} />
      <SelectionBadge
        selectedIds={selectedIds}
        selectedWidget={selectedWidget}
        selectedGroup={selectedGroup}
        selectedGroupName={selectedGroup ? groupNames[selectedGroup] : undefined}
        selectedTags={
          selectedWidget?.tagIds?.map((id) => tags[id]).filter((tag): tag is Tag => Boolean(tag)) ??
          []
        }
        selectedLineSize={selectedLineSize}
      />
      <PresentationLayer
        board={board}
        widgets={widgets}
        camera={camera}
        setCamera={onCamera}
        connection={connection}
        presence={presence}
        canFacilitate={canFacilitate}
        panelOpen={presentationOpen}
        onPanelOpen={onPresentationOpen}
      />
      <VoteLayer
        session={voteSession}
        widgets={widgets}
        layouts={layouts}
        camera={camera}
        viewport={viewport}
        busy={voteBusy}
        offset={voteOffset}
        timerEndsAt={voteTimerEndsAt}
        meId={meId}
        labels={{
          fontFamily: settings.text.fontFamily,
          stubMax: settings.connectors.stubMax,
          stubRatio: settings.connectors.stubRatio,
        }}
        onVote={onVote}
        onWithdraw={onWithdrawVote}
        onOpen={onOpenVote}
      />
      <SocialLayer
        connection={connection}
        presence={presence}
        camera={camera}
        viewport={viewport}
        layouts={layouts}
        widgets={widgets}
        selectedIds={selectedIds}
        meId={meId}
        canComment={canComment}
        canManage={canManage}
        commentRequest={commentRequest}
        onSelectWidget={onSelect}
        commentsOpen={commentsOpen}
        onCommentsOpen={onCommentsOpen}
        onCommentsUnread={onCommentsUnread}
        reactionRequest={reactionRequest}
      />
      <InlineEditor
        target={editorTarget}
        onChange={onSetText}
        onCreateConnected={onCreateConnected}
        onClose={() => onEdit(null)}
      />
      <StickyBar
        target={stickyBar}
        actions={stickyActions}
        editing={Boolean(editingId)}
        formatSelection={formatSelection}
      />
      <ArrangeBar target={arrangeBar} actions={arrangeActions} />
      <ConnectorBar
        target={connectorBar}
        actions={connectorActions}
        // The label is text, so it opens in the same editor every other text uses.
        onEditLabel={() => {
          const id = connectorBar?.id;
          if (id) onEdit(id);
        }}
      />
      {selectedKanbanId && selectedKanban && (
        <div className="kanban-bar">
          <button type="button" onClick={() => onAddColumn(selectedKanbanId)}>
            {t("inspector.addColumn")}
          </button>
          <span className="muted">{t("canvas.widenHint")}</span>
        </div>
      )}
    </div>
  );
}
