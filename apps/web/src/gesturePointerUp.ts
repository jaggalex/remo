import {
  anchorSlotDecision,
  connectTargetAt,
  internalConnectors,
  placedWidget,
  unique,
} from "./canvasGeometry";
import type { NoteDirection } from "@remo/doc";
import type { GestureEnv } from "./gestureEnv";
import { boxOf, cellAt, facingSide, pickInRect, placementsInRect } from "@remo/canvas";
import type { ConnectorPatch } from "@remo/doc";

export function pointerUp(env: GestureEnv) {
  const { anchorPressRef, camera, cardPreviewRef, clearPreview, connectDraftRef, dragDeltaRef, dragRef, isCardOfKanban, layouts, marqueeRef, onAddWaypoint, onConnect, onCreateConnected, onConnectorPatch, onLimit, onMoveCard, onMoveMany, onMoveToCell, onMoveWaypoint, onReattachEnd, onResize, onSelect, previewLive, selectedIds, setConnectDraft, setDragGhostIds, setDragIds, setDragPreview, setGuides, setHoverCell, setMarquee, setTableHover, setTableRefused, settings, widgetById, widgets } = env;
  const drag = dragRef.current;
  dragRef.current = null;

  if (drag?.mode === "connector") {
    const patch = previewLive.current.get(drag.id);
    clearPreview();
    if (drag.handle === "midpoint" && patch?.waypoints) {
      const added = patch.waypoints.find((point) => point.id === "__preview");
      if (added && !onAddWaypoint(drag.id, added.x, added.y, drag.segment)) onLimit();
      return;
    }
    if (drag.handle === "waypoint" && drag.waypointId && patch?.waypoints) {
      const moved = patch.waypoints.find((point) => point.id === drag.waypointId);
      if (moved) onMoveWaypoint(drag.id, drag.waypointId, moved.x, moved.y);
      return;
    }
    if (patch) onConnectorPatch(drag.id, patch as ConnectorPatch);
    return;
  }

  if (drag?.mode === "reattach") {
    const draft = connectDraftRef.current;
    connectDraftRef.current = null;
    setConnectDraft(null);
    const target = draft ? connectTargetAt(draft, layouts, widgets, isCardOfKanban, 160 / camera.zoom) : null;
    if (target && target.id !== drag.id && target.id !== drag.otherItem) {
      onReattachEnd(drag.id, drag.end, target.id, draft?.targetSide);
    }
    return;
  }

  if (drag?.mode === "connect") {
    const press = anchorPressRef.current;
    anchorPressRef.current = null;
    const draft = connectDraftRef.current;
    const direction: NoteDirection =
      drag.fromSide === "left"
        ? "left"
        : drag.fromSide === "top"
          ? "up"
          : drag.fromSide === "bottom"
            ? "down"
            : "right";
    connectDraftRef.current = null;
    setConnectDraft(null);

    // A click on a port asks "what belongs in this place?". When the slot the copy
    // would take is free, the copy is grown there; when a connectable object already
    // stands in it, the click describes the relation instead of stacking a duplicate
    // on top of it. A pair that already has a line is left alone (ADR-137).
    if (press && !press.moved) {
      const source = widgetById(drag.fromId);
      if (source) {
        const decision = anchorSlotDecision(source, direction, widgets, layouts, {
          ratio: settings.notes.gapRatio,
          min: settings.notes.minGap,
        });
        if (decision.kind === "connect") {
          const created = onConnect(source.id, decision.target.id, {
            startSide: drag.fromSide,
            endSide: decision.endSide,
          });
          if (created) onSelect([created]);
          return;
        }
        if (decision.kind === "duplicate") return;
      }
      onCreateConnected(drag.fromId, direction);
      return;
    }

    const target = draft ? connectTargetAt(draft, layouts, widgets, isCardOfKanban, 160 / camera.zoom) : null;
    if (target && target.id !== drag.fromId) {
      const source = widgetById(drag.fromId);
      const endSide =
        draft?.targetSide ??
        (source
          ? facingSide(boxOf(placedWidget(target, layouts)), { x: source.x, y: source.y })
          : facingSide(boxOf(placedWidget(target, layouts)), { x: draft?.x ?? 0, y: draft?.y ?? 0 }));
      onConnect(drag.fromId, target.id, {
        startSide: drag.fromSide,
        endSide,
      });
    }
    return;
  }

  if (drag?.mode === "card") {
    const layout = layouts.get(drag.kanbanId);
    const point = cardPreviewRef.current;
    const target = layout && point ? cellAt(layout, point) : null;
    if (target) onMoveCard(drag.kanbanId, drag.cardId, target.columnId, target.swimlaneId);
  }

  if (drag?.mode === "resize") {
    const patch = previewLive.current.get(drag.id);
    clearPreview();
    if (patch && patch.width != null && patch.height != null) {
      onResize({
        id: drag.id,
        x: patch.x ?? 0,
        y: patch.y ?? 0,
        width: patch.width,
        height: patch.height,
      });
    }
    return;
  }

  if (drag?.mode === "widget") {
    if (drag.table) {
      // A cross-cell drop: membership and the landing offset are one transaction.
      onMoveToCell(
        drag.table.frameId,
        drag.table.rowId,
        drag.table.columnId,
        drag.origins.map((origin) => origin.id),
        drag.table.offset,
      );
    } else if (!drag.refused) {
      const delta = dragDeltaRef.current;
      if (delta && (Math.abs(delta.dx) > 0.5 || Math.abs(delta.dy) > 0.5)) {
        // One gesture, one transaction.
        onMoveMany(
          drag.origins.map((o) => ({ id: o.id, x: o.x + delta.dx, y: o.y + delta.dy })),
        );
      }
    }
    setTableHover(null);
    setTableRefused(false);
  }

  const marqueeRect = marqueeRef.current;
  if (drag?.mode === "marquee" && marqueeRect) {
    // A marquee drawn inside a kanban targets its cards; anywhere else targets
    // the widgets themselves (the kanban is then one object, as it is when clicked).
    const host = drag.hostId ? layouts.get(drag.hostId) : undefined;
    const touched = host
      ? placementsInRect(host, marqueeRect).map((p) => p.cardId)
      : pickInRect(widgets, marqueeRect, isCardOfKanban).map((w) => w.id);
    const picked = drag.additive ? unique([...selectedIds, ...touched]) : touched;
    // A line joins the selection only when both of its ends do (ADR-138): one end, or
    // a line merely crossing the rectangle, is not what the marquee is around. The id
    // set is resolved first, so the order the objects were picked in does not matter.
    onSelect(
      unique([
        ...picked,
        ...internalConnectors(widgets, picked, layouts).map((connector) => connector.id),
      ]),
    );
  }

  cardPreviewRef.current = null;
  marqueeRef.current = null;
  dragDeltaRef.current = null;
  setDragPreview(null);
  setHoverCell(null);
  setMarquee(null);
  clearPreview();
  setDragIds([]);
  setDragGhostIds([]);
  setGuides([]);
}
