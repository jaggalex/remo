import {
  connectTargetAt,
  hoveredCell,
  inTableCell,
  nearestAnchor,
  placedWidget,
  resizedBox,
  tableDropAt,
  tableDropOffset,
  tableDropSelection,
} from "./canvasGeometry";
import type { GestureEnv } from "./gestureEnv";
import { bendStep, curveStep, flipStep, moveStep } from "./gestureSteps";
import type { ConnectDraft } from "./gestureTypes";
import { cellAt, cellGuides, closestOnPath, connectorPath, pick, rectFrom } from "@remo/canvas";
import { minimumSizeOf, type Widget } from "@remo/model";

/**
   * Boxes a dragged object can line up with.
   *
   * Other objects give their own box; a kanban additionally gives each of its
   * columns, because lining a sticky up with a column is the grid people actually
   * work in. Cards inside a kanban are skipped: their place is derived from the
   * matrix, not chosen by dragging a widget.
   */
export function pointerMove(env: GestureEnv, event: React.PointerEvent<HTMLCanvasElement>) {
  const { alignmentTargets, anchorNear, anchorPressRef, applyPreview, camera, cardPreviewRef, connectDraftRef, connectPendingRef, dragDeltaRef, dragRef, isCardOfKanban, layouts, marqueeRef, onCamera, publishCursor, setConnectDraft, setCursor, setDragPreview, setGuides, setHoverAnchor, setHoverCell, setHoverId, setMarquee, setTableHover, setTableRefused, settings, toWorld, widgetById, widgets } = env;
  const drag = dragRef.current;
  setCursor({ x: event.clientX, y: event.clientY });
  const world = toWorld(event);
  publishCursor(world);

  if (!drag) {
    const pending = connectPendingRef.current;
    if (pending) {
      const target = connectTargetAt(world, layouts, widgets, isCardOfKanban, 160 / camera.zoom);
      const allowed = target && target.id !== pending.fromId;
      const snapped = allowed ? nearestAnchor(placedWidget(target, layouts), world) : null;
      const draft: ConnectDraft = {
        fromId: pending.fromId,
        fromSide: pending.fromSide,
        x: world.x,
        y: world.y,
        ...(allowed && snapped
          ? {
              targetId: target.id,
              targetSide: snapped.side,
              targetPoint: { x: snapped.x, y: snapped.y },
            }
          : {}),
      };
      connectDraftRef.current = draft;
      setConnectDraft(draft);
      return;
    }
    const hovered = hoveredCell(layouts, world);
    setHoverCell((current) =>
      current?.columnId === hovered?.columnId && current?.swimlaneId === hovered?.swimlaneId
        ? current
        : hovered,
    );
    // Anchors sit outside the note, so the pointer leaves the box on the way to
    // one. Without this the anchors would disappear exactly when you reached them.
    // The anchor ring wins over whatever is under the pointer: an anchor outside a
    // note that sits on a kanban would otherwise report the kanban and vanish.
    const directly = pick(widgets, world, isCardOfKanban)?.id ?? null;
    const near = anchorNear(world);
    setHoverAnchor(near);
    setHoverId(near?.id ?? directly);
    return;
  }

  if (drag.mode === "pan") {
    const dx = (event.clientX - drag.startScreen.x) / camera.zoom;
    const dy = (event.clientY - drag.startScreen.y) / camera.zoom;
    onCamera({ ...camera, x: drag.startCamera.x - dx, y: drag.startCamera.y - dy });
    return;
  }

  if (drag.mode === "widget") {
    // Alignment is applied to the footprint, so a group of notes snaps as one
    // object and the dashed lines explain the few pixels it was pulled.
    const { delta, guides } = moveStep({
      box: drag.box,
      raw: { dx: world.x - drag.start.x, dy: world.y - drag.start.y },
      targets: alignmentTargets(drag.origins.map((o) => o.id)),
      threshold: settings.snapping.thresholdPx / camera.zoom,
    });
    dragDeltaRef.current = delta;
    // The footprint as patches: the painter, the hit-test and every connector that
    // ends on one of these objects read the same numbers (ADR-051).
    const next = new Map<string, Partial<Widget>>();
    for (const origin of drag.origins) {
      next.set(origin.id, { x: origin.x + delta.dx, y: origin.y + delta.dy });
    }

    // A table cell under the pointer is a drop target. A cross-cell move lands the
    // whole selection at the cell's padding corner, so the preview and the command
    // use one offset; a header refuses the drop and the objects stay put.
    const ids = drag.origins.map((origin) => origin.id);
    let tableHover: { frameId: string; rowId: string; columnId: string } | null = null;
    let refused = false;
    drag.table = undefined;
    if (tableDropSelection(widgets, ids)) {
      const hit = tableDropAt(widgets, world);
      if (hit?.kind === "cell") {
        tableHover = {
          frameId: hit.target.frameId,
          rowId: hit.target.rowId,
          columnId: hit.target.columnId,
        };
        const alreadyThere = drag.origins.every((origin) => {
          const widget = widgetById(origin.id);
          return widget ? inTableCell(widget, hit.target) : false;
        });
        if (!alreadyThere) {
          const offset = tableDropOffset(hit.target, widgets, ids);
          if (offset) {
            for (const origin of drag.origins) {
              next.set(origin.id, {
                x: origin.x + offset.x,
                y: origin.y + offset.y,
              });
            }
            drag.table = {
              frameId: hit.target.frameId,
              rowId: hit.target.rowId,
              columnId: hit.target.columnId,
              offset,
            };
          }
        }
      } else if (hit?.kind === "header") {
        refused = true;
        for (const origin of drag.origins) {
          next.set(origin.id, { x: origin.x, y: origin.y });
        }
      }
    }
    drag.refused = refused;
    setTableHover(tableHover);
    setTableRefused(refused);
    applyPreview(next);
    setGuides(settings.snapping.guides ? guides : []);
    return;
  }

  if (drag.mode === "resize") {
    // The floor belongs to the kind, not to this gesture: a frame may not collapse
    // below its title band, a note keeps the generic minimum (ADR-141).
    const minimum = minimumSizeOf(widgetById(drag.id)?.type ?? "unsupported");
    const box = resizedBox(drag.origin, drag.corner, world, minimum.width, minimum.height);
    applyPreview(
      new Map([
        [
          drag.id,
          {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            width: box.width,
            height: box.height,
          },
        ],
      ]),
    );
    return;
  }

  if (drag.mode === "connector") {
    const live = widgetById(drag.id) ?? drag.origin;
    const path =
      connectorPath(live, widgetById, {
        max: settings.connectors.stubMax,
        ratio: settings.connectors.stubRatio,
      }) ?? drag.path;

    if (drag.handle === "label") {
      const at = closestOnPath(path, world);
      applyPreview(new Map([[drag.id, { labelAt: { t: at.t, offset: at.offset } }]]));
      return;
    }

    if (drag.handle === "waypoint" && drag.waypointId) {
      const points = (drag.origin.waypoints ?? []).map((point) =>
        point.id === drag.waypointId ? { ...point, x: world.x, y: world.y } : point,
      );
      applyPreview(new Map([[drag.id, { waypoints: points }]]));
      return;
    }

    if (drag.handle === "midpoint") {
      const points = [...(drag.origin.waypoints ?? [])];
      const at = Math.min(Math.max(drag.segment ?? points.length, 0), points.length);
      points.splice(at, 0, { id: "__preview", x: world.x, y: world.y, rigid: true });
      applyPreview(new Map([[drag.id, { waypoints: points }]]));
      return;
    }

    if (drag.handle === "end") return;

    if (drag.handle === "bend") {
      if (drag.axis == null || drag.from == null || drag.to == null) return;
      const bend = bendStep(world, drag.axis, drag.from, drag.to);
      applyPreview(new Map([[drag.id, { bend }]]));
      return;
    }

    if (drag.handle === "flip") {
      if (!drag.at || !drag.alternate) return;
      const elbowFlip = flipStep(world, drag.at, drag.alternate);
      applyPreview(new Map([[drag.id, { elbowFlip }]]));
      return;
    }

    // A curve's handles pull its control points along their side's normal.
    if (drag.handle !== "curveFrom" && drag.handle !== "curveTo") return;
    const start = drag.path.points[0]!;
    const end = drag.path.points[drag.path.points.length - 1]!;
    const natural = Math.max(60, Math.hypot(end.x - start.x, end.y - start.y) * 0.42);
    const curve = curveStep({
      handle: drag.handle,
      point: world,
      path: drag.path,
      current: drag.origin.curve ?? { from: natural, to: natural },
    });
    applyPreview(new Map([[drag.id, { curve }]]));
    return;
  }

  if (drag.mode === "cellPress") {
    // A few pixels of travel is still a click on the cell; past that it is a marquee
    // over the board, so dragging from an empty cell keeps working.
    if (
      Math.hypot(event.clientX - drag.startScreen.x, event.clientY - drag.startScreen.y) <= 4
    ) {
      return;
    }
    dragRef.current = { mode: "marquee", start: drag.start, additive: drag.additive };
    marqueeRef.current = rectFrom(drag.start, world);
    setMarquee(marqueeRef.current);
    return;
  }

  if (drag.mode === "marquee") {
    marqueeRef.current = rectFrom(drag.start, world);
    setMarquee(marqueeRef.current);
    return;
  }

  if (drag.mode === "connect") {
    // A few pixels of travel is still a click: the person aimed at an anchor, not
    // at a line. Past that it is a connector drag.
    const press = anchorPressRef.current;
    if (
      press &&
      !press.moved &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4
    ) {
      press.moved = true;
    }
    const target = connectTargetAt(world, layouts, widgets, isCardOfKanban, 160 / camera.zoom);
    const snapped = target && target.id !== drag.fromId ? nearestAnchor(placedWidget(target, layouts), world) : null;
    const draft: ConnectDraft = {
      fromId: drag.fromId,
      fromSide: drag.fromSide,
      x: world.x,
      y: world.y,
      ...(target && target.id !== drag.fromId && snapped
        ? {
            targetId: target.id,
            targetSide: snapped.side,
            targetPoint: { x: snapped.x, y: snapped.y },
          }
        : {}),
    };
    connectDraftRef.current = draft;
    setConnectDraft(draft);
    return;
  }

  if (drag.mode === "reattach") {
    const target = connectTargetAt(world, layouts, widgets, isCardOfKanban, 160 / camera.zoom);
    const allowed = target && target.id !== drag.id && target.id !== drag.otherItem;
    const snapped = allowed ? nearestAnchor(placedWidget(target, layouts), world) : null;
    const draft: ConnectDraft = {
      fromId: drag.otherItem,
      fromSide: drag.otherSide,
      x: world.x,
      y: world.y,
      ...(allowed && snapped
        ? {
            targetId: target.id,
            targetSide: snapped.side,
            targetPoint: { x: snapped.x, y: snapped.y },
          }
        : {}),
    };
    connectDraftRef.current = draft;
    setConnectDraft(draft);
    return;
  }

  const preview = { cardId: drag.cardId, x: world.x, y: world.y };
  cardPreviewRef.current = preview;
  setDragPreview(preview);

  const layout = layouts.get(drag.kanbanId);
  const cell = layout ? cellAt(layout, world) : null;
  setHoverCell(cell);
  // A card's place is decided by the cell, not by the pixel: the honest guides are
  // the ones the card will really land on — the cell's card edges.
  setGuides(layout && cell ? cellGuides(layout, cell) : []);
}
