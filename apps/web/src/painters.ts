import {
  ANCHOR_GAP,
  HANDLE_GAP,
  anchorsOf,
  cornerPoints,
  placementOfCard,
} from "./canvasGeometry";
import {
  anchorPoint,
  boxOf,
  connectorHandles,
  connectorPath,
  drawDragOrigin,
  drawGuide,
  drawKanban,
  drawKanbanHover,
  drawWidget,
  isVisible,
  labelPoint,
  paintOrder,
  translateLayout,
  visibleWorldRect,
  type Camera,
  type KanbanLayout,
  type PaintTheme,
  withAlpha,
} from "@remo/canvas";
import { bounds, canConnect, kindOf, soleSelectedGroup, type Widget } from "@remo/model";
import type { Presence } from "@remo/doc";
import type { BoardSettings } from "./settings";
import { drawRemoteCursor } from "./remoteCursor";
import type { ConnectorSide } from "@remo/model";

/**
 * Size a layer's backing store to the viewport and hand back its context.
 *
 * Retina devices double the pixel count, so every layer has to be told; doing it in one
 * place keeps the two painters from disagreeing about the transform (ADR-056).
 */
export function prepareLayer(
  canvas: HTMLCanvasElement,
  viewport: { width: number; height: number },
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(viewport.width * dpr);
  canvas.height = Math.round(viewport.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** What the board layer needs to paint one frame (ADR-056). */
export interface BoardPaintInput {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  viewport: { width: number; height: number };
  settings: BoardSettings;
  grid: "off" | "lines" | "dots";
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  cardTitles: Map<string, string>;
  /** groupId → name; empty when no group is named (ADR-101). */
  groupNames: Record<string, string>;
  selectedIds: readonly string[];
  preview: ReadonlyMap<string, Partial<Widget>>;
  dragIds: readonly string[];
  dragGhostIds: readonly string[];
  draggedCardId: string | null;
  resolve: (id: string) => Widget | undefined;
  isCardOfKanban: (widget: Widget) => boolean;
  theme: PaintTheme;
}

export function paintBoardLayer(input: BoardPaintInput): void {
  const { ctx, camera, viewport, settings, grid, widgets, layouts, cardTitles, groupNames } =
    input;
  const cards = new Map(widgets.filter((widget) => widget.type === "card").map((widget) => [widget.id, widget]));
  const { width, height } = viewport;
  const {
    selectedIds,
    preview,
    dragIds,
    dragGhostIds,
    draggedCardId,
    resolve: widgetById,
    isCardOfKanban,
    theme,
  } = input;
  const palette = theme.palette;

  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);

  // The grid is a view preference: it helps to line things up and must never be
  // part of the document (ADR-031). A world-fixed step keeps it stable while
  // panning; the step doubles or halves so it stays readable at any zoom.
  let worldStep = settings.grid.size;
  while (worldStep * camera.zoom < 12) worldStep *= 2;
  while (worldStep * camera.zoom > 90) worldStep /= 2;
  const step = worldStep * camera.zoom;

  if (grid !== "off") {
    const offsetX = ((-camera.x * camera.zoom + width / 2) % step + step) % step;
    const offsetY = ((-camera.y * camera.zoom + height / 2) % step + step) % step;

    if (grid === "lines") {
      ctx.strokeStyle = withAlpha(palette.textPrimary, 0.07);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = offsetX; x < width; x += step) {
        const at = Math.round(x) + 0.5;
        ctx.moveTo(at, 0);
        ctx.lineTo(at, height);
      }
      for (let y = offsetY; y < height; y += step) {
        const at = Math.round(y) + 0.5;
        ctx.moveTo(0, at);
        ctx.lineTo(width, at);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = withAlpha(palette.textPrimary, 0.13);
      for (let x = offsetX; x < width; x += step) {
        for (let y = offsetY; y < height; y += step) {
          ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
        }
      }
    }
  }

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Culling: on a large board most objects are off-screen, and they cost nothing here.
  const visible = visibleWorldRect(camera, viewport);

  // A selected group gets one box around the whole thing instead of an outline
  // on every member, which is how the source product shows a group.
  const groupId = soleSelectedGroup(widgets, selectedIds);
  const grouped = groupId ? widgets.filter((widget) => widget.groupId === groupId) : [];
  const singleNote =
    selectedIds.length === 1 ? widgetById(selectedIds[0]!) : undefined;
  const noteSelected =
    singleNote && (singleNote.type === "sticky_note" || singleNote.type === "text");

  const outlined = grouped.length
    ? selectedIds.filter((id) => !grouped.some((widget) => widget.id === id))
    : noteSelected
      ? []
      : selectedIds;

  // Endpoints resolve through the preview, so a line stays attached to an object
  // while it is carried or resized instead of waiting for the drop.
  const resolveForDrag = widgetById;

  // The dragged card is painted on the overlay, following the pointer. Keeping it
  // out of the matrix is what leaves only its ghost behind.
  for (const painted of paintOrder(widgets)) {
    // One lookup for every gesture: a line being reshaped, a note being resized and
    // anything being carried are all patches in the same map (ADR-051).
    const patch = preview.get(painted.id);
    const widget = patch ? { ...painted, ...patch } : painted;
    if (isCardOfKanban(widget)) continue;
    if (!isVisible(widget, visible)) continue;
    const dragging = dragIds.includes(widget.id);

    if (dragging) {
      // A lifted object carries a soft shadow, so it reads as "in hand" rather
      // than as a duplicate of what is still in place.
      ctx.save();
      ctx.shadowColor = withAlpha(palette.textPrimary, 0.28);
      ctx.shadowBlur = 18 / camera.zoom;
      ctx.shadowOffsetY = 6 / camera.zoom;
    }
    drawWidget(ctx, widget, camera.zoom, {
      selectedIds: outlined,
      resolve: resolveForDrag,
      theme,
    });
    if (dragging) ctx.restore();

    const layout = layouts.get(painted.id);
    if (layout) {
      // A dragged kanban takes its whole matrix with it: the patch on the widget is
      // the offset, so the matrix is translated by exactly the same amount.
      const dx = widget.x - painted.x;
      const dy = widget.y - painted.y;
      drawKanban(
        ctx,
        dx || dy ? translateLayout(layout, dx, dy) : layout,
        camera.zoom,
        cardTitles,
        {
          selectedIds: outlined,
          hiddenCardId: draggedCardId,
          placeholder: theme.cardPlaceholder,
          palette,
          fontFamily: theme.fontFamily,
          cards,
          cardStatus: theme.cardStatus,
        },
      );
    }
  }

  // Where the lifted objects came from — the frame, not each of its children.
  for (const id of dragGhostIds) {
    // Deliberately the stored widget, not the previewed one: the ghost marks where
    // the object came from.
    const widget = widgets.find((candidate) => candidate.id === id);
    if (!widget || isCardOfKanban(widget)) continue;
    drawDragOrigin(
      ctx,
      {
        x: widget.x - widget.width / 2,
        y: widget.y - widget.height / 2,
        width: widget.width,
        height: widget.height,
      },
      camera.zoom,
      0,
      palette,
    );
  }

  if (draggedCardId) {
    const placement = placementOfCard(layouts, draggedCardId);
    if (placement) {
      drawDragOrigin(
        ctx,
        {
          x: placement.x - placement.width / 2,
          y: placement.y - placement.height / 2,
          width: placement.width,
          height: placement.height,
        },
        camera.zoom,
        placement.height / 2.6,
        palette,
      );
    }
  }

  if (grouped.length) {
    const moved = grouped.map((widget) => {
      const patch = preview.get(widget.id);
      return patch ? { ...widget, ...patch } : widget;
    });
    const box = bounds(moved);
    const pad = 4 / camera.zoom;
    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
  }

  // A named group carries a label above its union box. It is not a container: no
  // clipping, no title hit area, no geometry (ADR-101).
  const namedGroups = new Map<string, Widget[]>();
  for (const widget of widgets) {
    if (!widget.groupId || !groupNames[widget.groupId]) continue;
    const list = namedGroups.get(widget.groupId) ?? [];
    list.push(widget);
    namedGroups.set(widget.groupId, list);
  }
  if (namedGroups.size) {
    ctx.fillStyle = palette.textSecondary;
    ctx.textBaseline = "bottom";
    ctx.font = `${12 / camera.zoom}px Inter, sans-serif`;
    for (const [groupId, members] of namedGroups) {
      const box = bounds(members);
      const intersects =
        box.x <= visible.x + visible.width &&
        box.x + box.width >= visible.x &&
        box.y <= visible.y + visible.height &&
        box.y + box.height >= visible.y;
      if (!intersects) continue;
      ctx.fillText(groupNames[groupId]!, box.x, box.y - 6 / camera.zoom);
    }
  }

  ctx.restore();
}

/** What the overlay needs: chrome, cursors, the gesture in flight (ADR-056). */
export interface OverlayPaintInput {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  viewport: { width: number; height: number };
  settings: BoardSettings;
  layouts: Map<string, KanbanLayout>;
  selectedIds: readonly string[];
  preview: ReadonlyMap<string, Partial<Widget>>;
  editingId: string | null;
  hoverId: string | null;
  hoverAnchor: { id: string; side: ConnectorSide } | null;
  hoverCell: { columnId: string; swimlaneId: string } | null;
  connectDraft: {
    fromId: string;
    fromSide: ConnectorSide;
    x: number;
    y: number;
    targetId?: string;
    targetSide?: ConnectorSide;
    targetPoint?: { x: number; y: number };
  } | null;
  dragPreview: { cardId: string; x: number; y: number } | null;
  guides: Parameters<typeof drawGuide>[1][];
  marquee: { x: number; y: number; width: number; height: number } | null;
  presence: Presence[];
  resolve: (id: string) => Widget | undefined;
  theme: PaintTheme;
  /** Point the keyboard is walking over, drawn with a focus ring. */
  focusedWaypoint?: { connectorId: string; waypointId: string } | null;
}

export function paintOverlayLayer(input: OverlayPaintInput): void {
  const { ctx, camera, viewport, settings, layouts } = input;
  const { width, height } = viewport;
  const {
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
    resolve: widgetById,
    theme,
    focusedWaypoint,
  } = input;
  const palette = theme.palette;

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // The cell tint is a card-drop affordance: while a note is being dragged or
  // resized, a highlight left over from an earlier hover would just sit on top.
  if (hoverCell && preview.size === 0) {
    for (const layout of layouts.values()) {
      drawKanbanHover(ctx, layout, hoverCell, palette);
    }
  }

  // Four connector anchors on a single selection, and the link being dragged.
  const selected = selectedIds.length === 1 ? widgetById(selectedIds[0]!) : undefined;
  if (selected && canConnect(selected) && !editingId && preview.size === 0 && hoverId === selected.id) {
    for (const anchor of anchorsOf(selected, ANCHOR_GAP / camera.zoom)) {
      const active = hoverAnchor?.id === selected.id && hoverAnchor.side === anchor.side;
      ctx.fillStyle = active ? palette.textPrimary : palette.panel;
      ctx.strokeStyle = palette.textPrimary;
      ctx.lineWidth = (active ? 2.5 : 2) / camera.zoom;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, (active ? 6.5 : 5.5) / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (connectDraft) {
    const source = widgetById(connectDraft.fromId);
    if (source) {
      const start = anchorPoint(boxOf(source), connectDraft.fromSide);
      const end = connectDraft.targetPoint ?? { x: connectDraft.x, y: connectDraft.y };
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2 / camera.zoom;
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // The object being aimed at shows all four of its anchors, with the one the
    // line will take filled in.
    const target = connectDraft.targetId ? widgetById(connectDraft.targetId) : undefined;
    if (target) {
      for (const anchor of anchorsOf(target, ANCHOR_GAP / camera.zoom)) {
        const chosen = anchor.side === connectDraft.targetSide;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, (chosen ? 6.5 : 5) / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = chosen ? palette.accent : palette.panel;
        ctx.fill();
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 2 / camera.zoom;
        ctx.stroke();
      }
    }
  }

  if (dragPreview) {
    const card = widgetById(dragPreview.cardId);
    if (card) {
      ctx.save();
      ctx.shadowColor = withAlpha(palette.textPrimary, 0.3);
      ctx.shadowBlur = 18 / camera.zoom;
      ctx.shadowOffsetY = 6 / camera.zoom;
      // The real widget, so the card keeps its title and text while it is carried.
      drawWidget(
        ctx,
        { ...card, x: dragPreview.x, y: dragPreview.y },
        camera.zoom,
        { theme },
      );
      ctx.restore();
    }
  }

  // Resize handles: one note selected, to the four corners.
  const single = selectedIds.length === 1 ? widgetById(selectedIds[0]!) : undefined;
  const box =
    single && !editingId && kindOf(single.type).resizable ? boxOf(single) : null;
  if (box) {
    const radius = 4.5 / camera.zoom;
    for (const corner of cornerPoints(box, HANDLE_GAP / camera.zoom)) {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = palette.panel;
      ctx.fill();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.stroke();
    }
  }

  // The handles that reshape a selected line: two blue dots, like the source
  // product, on the part of the route that can move (ADR-044).
  if (single && single.type === "connector" && !single.locked && !editingId) {
    const path = connectorPath(single, widgetById, {
      max: settings.connectors.stubMax,
      ratio: settings.connectors.stubRatio,
    });
    if (path) {
      for (const handle of connectorHandles(path, single)) {
        const hollow = handle.kind === "end" || handle.kind === "waypoint";
        ctx.beginPath();
        ctx.arc(handle.point.x, handle.point.y, 4.5 / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = hollow ? palette.panel : palette.accent;
        ctx.fill();
        ctx.strokeStyle = hollow ? palette.accent : palette.panel;
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.stroke();
      }

      if (focusedWaypoint?.connectorId === single.id) {
        const focused = connectorHandles(path, single).find(
          (handle) => handle.waypointId === focusedWaypoint.waypointId,
        );
        if (focused) {
          ctx.beginPath();
          ctx.arc(focused.point.x, focused.point.y, 7.5 / camera.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = palette.selectionStroke;
          ctx.lineWidth = 2 / camera.zoom;
          ctx.stroke();
        }
      }

      // A label can be moved too; its handle only exists once there is a label.
      if (single.content?.trim()) {
        const at = labelPoint(path, single.labelAt);
        ctx.beginPath();
        ctx.arc(at.x, at.y, 5 / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = palette.panel;
        ctx.fill();
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.stroke();
      }
    }
  }

  // Alignment lines last, so nothing covers them. They span the whole viewport
  // rather than only the two boxes: an alignment is a line across the board, and a
  // segment hidden under the object being dragged would not explain anything.
  if (guides.length && settings.snapping.guides) {
    const visible = visibleWorldRect(camera, viewport);
    for (const guide of guides) {
      drawGuide(
        ctx,
        guide.axis === "x"
          ? { ...guide, from: visible.y, to: visible.y + visible.height }
          : { ...guide, from: visible.x, to: visible.x + visible.width },
        camera.zoom,
        palette,
      );
    }
  }

  if (marquee) {
    ctx.fillStyle = palette.selectionFill;
    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
    ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
  }

  for (const peer of presence) {
    if (peer.self || !peer.cursor) continue;
    drawRemoteCursor(ctx, peer, camera.zoom, palette, theme.fontFamily);
  }

  ctx.restore();
}
