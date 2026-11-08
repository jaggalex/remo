import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  prepareLayer,
  paintBoardLayer,
  paintOverlayLayer,
  type BoardPaintInput,
  type OverlayPaintInput,
} from "./painters";
import { canvasPaletteFromTokens } from "./canvasPalette";
import { connectorResolver } from "./canvasGeometry";
import { useProposalLayout } from "./proposalStore";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Presence } from "@remo/doc";
import type { KanbanState, Widget } from "@remo/model";
import type { BoardSettings } from "./settings";
import type { GridStyle } from "./BoardCanvas";
import type { TranslationKey } from "./i18n";
import type { Gestures } from "./useGestures";

/**
 * The two canvases: what to paint, and when.
 *
 * The board layer is the document (camera, widgets, selection, drag preview); the overlay
 * layer is everything transient (cursors, marquee, guides, anchors). They are separate so
 * a stream of remote cursors repaints only the overlay.
 *
 * State changes never paint directly: they mark a layer dirty and one animation frame
 * paints whatever is dirty, so a burst of events costs one paint per frame. A timer backs
 * the frame up — an occluded window produces no animation frames and the board would
 * otherwise stay blank.
 */
export function useCanvasPainting({
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
  clock,
  t,
}: {
  boardRef: React.RefObject<HTMLCanvasElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: { width: number; height: number };
  camera: Camera;
  settings: BoardSettings;
  grid: GridStyle;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  cardTitles: Map<string, string>;
  groupNames: Record<string, string>;
  selectedIds: readonly string[];
  /** Everything transient the overlay paints; the hook reads it, never changes it. */
  gestures: Gestures;
  isCardOfKanban: (widget: Widget) => boolean;
  presence: Presence[];
  editingId: string | null;
  focusedWaypoint: { connectorId: string; waypointId: string } | null;
  kanbanStates: Record<string, KanbanState>;
  /** Changes once a second while the shared timer runs; the timer card paints from it. */
  clock: number;
  t: (key: TranslationKey) => string;
}) {
  const {
    preview,
    dragIds,
    dragGhostIds,
    draggedCardId,
    hoverId,
    hoverAnchor,
    hoverCell,
    connectDraft,
    dragPreview,
    guides,
    marquee,
  } = gestures;

  // Cards resolve their box through the kanban placement (ADR-113), so a connector
  // to a card follows it between columns without a document write.
  const resolveConnector = useMemo(
    () => connectorResolver(widgets, layouts),
    [widgets, layouts],
  );

  // A plan under review is painted over the room (ADR-188).
  const proposal = useProposalLayout(resolveConnector, viewport);

  const paintStats = useRef({
    board: 0,
    overlay: 0,
    lastBoardMs: 0,
    lastOverlayMs: 0,
    schedules: 0,
    flushes: 0,
    /** Last paint failure, so a silent blank canvas is explainable. */
    error: "",
    boardInvalidations: 0,
    lastBoardReason: "",
  });

  /**
   * Canvas colours come from the design-system tokens (ADR-078). Read them once and
   * again on a theme switch: the board is not remounted, so a stale palette would
   * leave the canvas in the previous theme.
   */
  const [palette, setPalette] = useState(canvasPaletteFromTokens);
  useEffect(() => {
    const read = () => setPalette(canvasPaletteFromTokens());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  /**
   * Canvas text does not wait for a web font: a note painted before Golos Text arrives is
   * measured and drawn in the fallback. Repaint once each batch of faces finishes loading,
   * so wraps and the auto-fitted size are computed with the real letters.
   */
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let alive = true;
    const bump = () => {
      if (alive) setFontsLoaded((count) => count + 1);
    };
    void fonts.ready.then(bump);
    fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      fonts.removeEventListener?.("loadingdone", bump);
    };
  }, []);

  /** Fonts, text caps, the card placeholder and the canvas palette. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontsLoaded` only triggers a repaint.
  const paintTheme = useMemo(
    () => ({
      fontFamily: settings.text.fontFamily,
      fontCap: settings.notes.fontCap,
      shapeStrokeWidth: settings.shapes.strokeWidth,
      cardPlaceholder: t("kanban.cardPlaceholder"),
      timerExpired: t("facilitation.timer.timeUp"),
      cardStatus: {
        todo: t("card.status.todo"),
        in_progress: t("card.status.in_progress"),
        done: t("card.status.done"),
      },
      palette,
    }),
    // `fontsLoaded` is not read: a new theme object is what makes both layers repaint.
    [settings, t, palette, fontsLoaded],
  );

  const paintBoard = useCallback(() => {
    const canvas = boardRef.current;
    if (!canvas) return;
    const started = performance.now();
    const ctx = prepareLayer(canvas, viewport);
    if (!ctx) return;
    const input: BoardPaintInput = {
      ctx,
      camera,
      viewport,
      settings,
      grid,
      widgets,
      layouts,
      cardTitles,
      groupNames,
      selectedIds,
      preview,
      dragIds,
      dragGhostIds,
      draggedCardId,
      resolve: resolveConnector,
      isCardOfKanban,
      theme: paintTheme,
    };
    paintBoardLayer(input);
    paintStats.current.board += 1;
    paintStats.current.lastBoardMs = performance.now() - started;
  }, [
    camera,
    cardTitles,
    dragGhostIds,
    dragIds,
    draggedCardId,
    editingId,
    grid,
    groupNames,
    isCardOfKanban,
    layouts,
    paintTheme,
    preview,
    selectedIds,
    settings,
    viewport,
    resolveConnector,
    widgets,
  ]);

  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const started = performance.now();
    const ctx = prepareLayer(canvas, viewport);
    if (!ctx) return;
    const input: OverlayPaintInput = {
      ctx,
      camera,
      viewport,
      settings,
      layouts,
      selectedIds,
      preview,
      editingId,
      hoverId,
      hoverAnchor,
      hoverCell,
      connectDraft,
      dragPreview,
      guides,
      marquee,
      presence,
      resolve: resolveConnector,
      theme: paintTheme,
      focusedWaypoint,
      proposal,
    };
    paintOverlayLayer(input);
    paintStats.current.overlay += 1;
    paintStats.current.lastOverlayMs = performance.now() - started;
  }, [
    camera,
    connectDraft,
    dragPreview,
    editingId,
    guides,
    hoverAnchor,
    hoverCell,
    focusedWaypoint,
    hoverId,
    layouts,
    marquee,
    paintTheme,
    presence,
    preview,
    proposal,
    selectedIds,
    settings,
    viewport,
    resolveConnector,
  ]);

  /**
   * Coalesced redraw: state changes only mark a layer dirty, and one animation frame
   * paints whatever is dirty. A burst of events (a drag, a stream of remote cursors)
   * therefore costs one paint per frame, not one per event.
   */
  const dirty = useRef({ board: true, overlay: true });
  const frame = useRef<number | null>(null);
  const fallback = useRef<number | null>(null);

  /**
   * Latest painters, so the scheduler below can be identity-stable.
   *
   * Looking the painters up through a ref keeps `invalidate` from changing whenever
   * a cursor moves; otherwise the board-layer effect would re-run on every pointer
   * event and repaint the whole board.
   */
  const painters = useRef({ board: paintBoard, overlay: paintOverlay });
  useEffect(() => {
    painters.current = { board: paintBoard, overlay: paintOverlay };
  }, [paintBoard, paintOverlay]);

  /**
   * Paint whatever is dirty.
   *
   * Scheduled through `requestAnimationFrame` so a burst of events costs one paint
   * per frame. A timer backs it up: a window that is occluded (or a tab the browser
   * has stopped compositing) never produces animation frames, and the board would
   * stay blank until it came back into view.
   */
  const flush = useCallback(() => {
    paintStats.current.flushes += 1;
    if (fallback.current != null) {
      window.clearTimeout(fallback.current);
      fallback.current = null;
    }
    if (frame.current != null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    try {
      if (dirty.current.board) {
        dirty.current.board = false;
        painters.current.board();
      }
      if (dirty.current.overlay) {
        dirty.current.overlay = false;
        painters.current.overlay();
      }
    } catch (error) {
      paintStats.current.error = String(error);
      dirty.current.board = true;
      dirty.current.overlay = true;
    }
  }, []);

  const schedulePaint = useCallback(() => {
    paintStats.current.schedules += 1;
    if (frame.current != null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      flush();
    });
    if (fallback.current == null) {
      fallback.current = window.setTimeout(() => {
        fallback.current = null;
        flush();
      }, 120);
    }
  }, [flush]);

  const invalidate = useCallback(
    (layers: { board?: boolean; overlay?: boolean }) => {
      if (layers.board) dirty.current.board = true;
      if (layers.overlay) dirty.current.overlay = true;
      schedulePaint();
    },
    [schedulePaint],
  );

  const invalidateBoard = useCallback(() => invalidate({ board: true }), [invalidate]);
  const invalidateOverlay = useCallback(() => invalidate({ overlay: true }), [invalidate]);

  // Board layer: camera, document, selection.
  const boardDeps = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (import.meta.env.DEV) {
      const now: Record<string, unknown> = {
        camera,
        widgets,
        kanbanStates,
        selectedIds,
        layouts,
        cardTitles,
        dragIds,
        dragGhostIds,
        draggedCardId,
        preview,
        clock,
      };
      const changed = Object.keys(now).filter((key) => boardDeps.current[key] !== now[key]);
      boardDeps.current = now;
      paintStats.current.boardInvalidations += 1;
      paintStats.current.lastBoardReason = changed.join(",") || "first";
    }
    invalidateBoard();
  }, [
    invalidateBoard,
    camera,
    widgets,
    kanbanStates,
    selectedIds,
    layouts,
    cardTitles,
    dragIds,
    dragGhostIds,
    draggedCardId,
    preview,
    clock,
    // The painter is memoized by theme, settings, grid, group names and viewport;
    // invalidating on the painter is what repaints a theme or language change.
    paintBoard,
  ]);

  // Overlay layer: cursors, marquee, drag ghost. Deliberately does not touch the board.
  useEffect(() => {
    invalidateOverlay();
  }, [
    invalidateOverlay,
    presence,
    marquee,
    dragPreview,
    hoverCell,
    hoverId,
    guides,
    connectDraft,
    editingId,
    selectedIds,
    camera,
    viewport,
    preview,
    // Covers hoverAnchor, focusedWaypoint and the theme, which the overlay paints.
    paintOverlay,
  ]);

  useEffect(() => {
    return () => {
      // Cancel *and* clear: leaving a stale id behind makes every later
      // schedulePaint() think a frame is already pending, which silently stops
      // painting for good (StrictMode remounts hit this immediately).
      if (frame.current != null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      if (fallback.current != null) {
        window.clearTimeout(fallback.current);
        fallback.current = null;
      }
    };
  }, []);
  return { invalidateBoard, invalidateOverlay, paintStats };
}
