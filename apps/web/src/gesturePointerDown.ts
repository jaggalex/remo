import { ANCHOR_GAP, HANDLE_GAP, anchorsOf, portsAreEdgePlus, bendAxis, connectTargetAt, cornerAt, nearestAnchor, placedWidget, resizeMembersOf } from "./canvasGeometry";
import type { GestureEnv } from "./gestureEnv";
import type { ConnectDraft } from "./gestureTypes";
import { boxOf, connectorHandles, connectorPath, facingSide, labelPoint, layerKey, layoutTable, pick, pickConnector, placementAt, plusHit, resolvedEndSide, tableHitAt, unionBox } from "@remo/canvas";
import { canConnect, expandGroups, minimumSizeOf, scalesInBlock } from "@remo/model";
import type { ConnectorSide } from "@remo/model";
import { capture } from "./gestureEnv";
import {
  clearTableCellSelection,
  setTableCellSelection,
  tableCellSelection,
} from "./tableCellSelection";

export function pointerDown(env: GestureEnv, event: React.PointerEvent<HTMLCanvasElement>) {
  const { anchorPressRef, beginWidgetDrag, camera, cardPreviewRef, connectDraftRef, connectPendingRef, connectorLabelAt, dragRef, isCardOfKanban, layouts, marqueeRef, onAddCard, onConnect, onSelect, readOnly, selectedIds, setConnectDraft, setConnectPending, setDragPreview, setMarquee, setTableHover, setTableRefused, settings, toWorld, widgetById, widgets, worldToScreenPoint } = env;
  const world = toWorld(event);

  // A resize handle is a UI affordance of the selection, so it is tried before the
  // objects and before panning: Alt over a handle resizes around the centre (ADR-212),
  // while Alt anywhere else still pans. One object or a block — the handle sits on the
  // union box and the gesture scales every member that can scale (ADR-211).
  const resizeMembers = resizeMembersOf(widgets, selectedIds, isCardOfKanban);
  if (!readOnly && event.button === 0 && resizeMembers.some(scalesInBlock)) {
    const box = unionBox(resizeMembers.map(boxOf));
    const hit = box ? cornerAt(box, world, 10 / camera.zoom, HANDLE_GAP / camera.zoom) : null;
    if (box && hit) {
      dragRef.current = {
        mode: "resize",
        id: resizeMembers[0]!.id,
        ids: resizeMembers.map((widget) => widget.id),
        corner: hit,
        origin: box,
        // Captured once: during the drag every move scales the original boxes, never
        // the preview it just painted.
        members: resizeMembers.map((widget) => ({
          id: widget.id,
          box: boxOf(widget),
          scalable: scalesInBlock(widget),
          min: minimumSizeOf(widget.type),
        })),
      };
      capture(event);
      return;
    }
  }

  setTableHover(null);
  setTableRefused(false);
  const panRequested = event.button === 1 || event.button === 2 || event.altKey;

  if (panRequested) {
    dragRef.current = {
      mode: "pan",
      startScreen: { x: event.clientX, y: event.clientY },
      startCamera: camera,
    };
    capture(event);
    return;
  }

  // A click on a table cell selects the cell once its section is selected (click-click,
  // ADR-204). An object inside the cell keeps its own selection; a click outside clears
  // the cell so the two selections never compete.
  if (!readOnly && event.button === 0) {
    const hit = tableCellAtPoint(world, widgets);
    const current = tableCellSelection();
    const frameSelected =
      hit && selectedIds.length === 1 && selectedIds[0] === hit.frame.id;
    if (hit?.cell && frameSelected) {
      const under = pick(widgets, world, isCardOfKanban);
      const empty = !under || under.id === hit.frame.id;
      if (empty) {
        event.preventDefault();
        const anchor =
          event.shiftKey && current?.frameId === hit.frame.id
            ? current.anchor
            : hit.cell;
        setTableCellSelection({ frameId: hit.frame.id, anchor, focus: hit.cell });
        dragRef.current = {
          mode: "cellPress",
          start: world,
          startScreen: { x: event.clientX, y: event.clientY },
          additive: event.shiftKey,
        };
        capture(event);
        return;
      }
    }
    if (current && (!hit?.cell || !frameSelected)) clearTableCellSelection();
  }

  if (!readOnly) {
    for (const [kanbanId, layout] of layouts) {
      const cell = plusHit(layout, world, camera.zoom);
      if (cell) {
        event.preventDefault();
        onAddCard(kanbanId, cell.columnId, cell.swimlaneId);
        return;
      }
    }
  }

  // A pending click-connect: the next click either lands on a target or cancels.
  const pending = connectPendingRef.current;
  if (pending) {
    const target = connectTargetAt(world, layouts, widgets, isCardOfKanban, 160 / camera.zoom);
    connectPendingRef.current = null;
    setConnectPending(false);
    connectDraftRef.current = null;
    setConnectDraft(null);
    if (target && target.id !== pending.fromId) {
      const snapped = nearestAnchor(placedWidget(target, layouts), world);
      onConnect(pending.fromId, target.id, {
        startSide: pending.fromSide,
        endSide: snapped.side,
      });
    }
    return;
  }

  // A label is grabbed directly, selected line or not.
  const labelOwner = readOnly ? null : connectorLabelAt(world);
  if (labelOwner) {
    const widget = widgetById(labelOwner);
    onSelect([labelOwner]);
    if (widget && !widget.locked) {
      const path = connectorPath(widget, widgetById, {
        max: settings.connectors.stubMax,
        ratio: settings.connectors.stubRatio,
      });
      if (path) {
        dragRef.current = {
          mode: "connector",
          id: labelOwner,
          handle: "label",
          origin: widget,
          path,
        };
        capture(event);
        return;
      }
    }
    return;
  }

  // The handles of a selected line sit on the line itself, so they are tried
  // before anything else that would claim the press (ADR-044).
  const soleLine = selectedIds.length === 1 ? widgetById(selectedIds[0]!) : undefined;
  if (!readOnly && soleLine && soleLine.type === "connector" && !soleLine.locked) {
    const path = connectorPath(soleLine, widgetById, {
      max: settings.connectors.stubMax,
      ratio: settings.connectors.stubRatio,
    });
    if (path) {
      const reached = (point: { x: number; y: number }) => {
        const screen = worldToScreenPoint(point);
        return Math.hypot(screen.x - event.clientX, screen.y - event.clientY) <= 12;
      };

      if (soleLine.content?.trim() && reached(labelPoint(path, soleLine.labelAt))) {
        dragRef.current = {
          mode: "connector",
          id: soleLine.id,
          handle: "label",
          origin: soleLine,
          path,
        };
        capture(event);
        return;
      }

      for (const handle of connectorHandles(path, soleLine)) {
        if (!reached(handle.point)) continue;
        if (handle.kind === "end") {
          const end = handle.index === 0 ? "start" : "end";
          const other = end === "start" ? soleLine.end : soleLine.start;
          const otherWidget = other?.item ? widgetById(other.item) : undefined;
          if (!other || !otherWidget) continue;
          const otherBox = boxOf(otherWidget);
          const otherSide = resolvedEndSide(
            other,
            otherBox,
            facingSide(otherBox, { x: soleLine.x, y: soleLine.y }),
          );
          dragRef.current = {
            mode: "reattach",
            id: soleLine.id,
            end,
            otherItem: other.item,
            otherSide,
          };
          const draft: ConnectDraft = {
            fromId: other.item,
            fromSide: otherSide,
            x: soleLine.x,
            y: soleLine.y,
          };
          connectDraftRef.current = draft;
          setConnectDraft(draft);
          onSelect([soleLine.id]);
          capture(event);
          return;
        }
        dragRef.current = {
          mode: "connector",
          id: soleLine.id,
          handle: handle.kind,
          origin: soleLine,
          path,
          ...bendAxis(soleLine, path, {
            max: settings.connectors.stubMax,
            ratio: settings.connectors.stubRatio,
          }),
          at: handle.point,
          ...(handle.alternate ? { alternate: handle.alternate } : {}),
          ...(handle.waypointId ? { waypointId: handle.waypointId } : {}),
          ...(handle.kind === "midpoint" ? { segment: handle.index } : {}),
        };
        // The handle is on the line: selecting the line here keeps its bar open.
        onSelect([soleLine.id]);
        capture(event);
        return;
      }
    }
  }

  // The connector anchor of the current selection wins over everything: it is a UI
  // affordance sitting on the object's edge.
  const anchorSource = selectedIds.length === 1 ? widgetById(selectedIds[0]!) : undefined;
  if (
    !readOnly &&
    anchorSource &&
    canConnect(anchorSource) &&
    !anchorSource.locked &&
    !portsAreEdgePlus(anchorSource)
  ) {
    let nearest: { side: ConnectorSide; distance: number } | null = null;
    for (const anchor of anchorsOf(anchorSource, ANCHOR_GAP / camera.zoom)) {
      const screen = worldToScreenPoint({ x: anchor.x, y: anchor.y });
      const distance = Math.hypot(screen.x - event.clientX, screen.y - event.clientY);
      if (distance <= 14 && (!nearest || distance < nearest.distance)) {
        nearest = { side: anchor.side, distance };
      }
    }
    if (nearest) {
      anchorPressRef.current = {
        fromId: anchorSource.id,
        side: nearest.side,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      dragRef.current = {
        mode: "connect",
        fromId: anchorSource.id,
        fromSide: nearest.side,
      };
      connectDraftRef.current = {
        fromId: anchorSource.id,
        fromSide: nearest.side,
        x: world.x,
        y: world.y,
      };
      setConnectDraft(connectDraftRef.current);
      capture(event);
      return;
    }
  }

  // What is under the cursor decides how the gesture is interpreted. The widget
  // that is painted on top wins, so an object dropped over a kanban stays
  // selectable (the kanban is only reached where nothing else covers it).
  const hit = pick(widgets, world, isCardOfKanban);

  // Connectors are picked by their line, not by their box, and only where nothing
  // painted above them covers the point (rank 3: above shapes and kanbans, below
  // notes, cards and text). Without this a connector could be created but never
  // selected — and so never deleted.
  const connector = pickConnector(widgets, world, 8 / camera.zoom, widgetById, {
    max: settings.connectors.stubMax,
    ratio: settings.connectors.stubRatio,
  });
  const target = connector && (!hit || layerKey(connector) > layerKey(hit)) ? connector : hit;

  if (target?.type === "connector") {
    onSelect([target.id]);
    // Nothing to drag: the line's geometry is derived from its two endpoints.
    beginWidgetDrag([], world);
    capture(event);
    return;
  }

  if (readOnly) return;
  if (hit && layouts.has(hit.id)) {
    const layout = layouts.get(hit.id)!;
    const placement = placementAt(layout, world);

    if (placement) {
      onSelect([placement.cardId]);
      dragRef.current = {
        mode: "card",
        kanbanId: hit.id,
        cardId: placement.cardId,
        offset: { x: world.x - placement.x, y: world.y - placement.y },
      };
      setDragPreview({ cardId: placement.cardId, x: world.x, y: world.y });
      cardPreviewRef.current = { cardId: placement.cardId, x: world.x, y: world.y };
      capture(event);
      return;
    }

    if (world.y < layout.top + layout.headerHeight) {
      // The header band is the board's own handle (drag the kanban widget). A
      // grouped kanban drags its whole group, like any other member.
      const selection = expandGroups(widgets, [hit.id]);
      onSelect(selection);
      beginWidgetDrag(selection, world);
      capture(event);
      return;
    }

    if (!event.shiftKey) onSelect([]);
    dragRef.current = { mode: "marquee", start: world, additive: event.shiftKey, hostId: hit.id };
    marqueeRef.current = { x: world.x, y: world.y, width: 0, height: 0 };
    setMarquee(marqueeRef.current);
    capture(event);
    return;
  }

  if (hit) {
    const additive = event.shiftKey;
    const hitIds = expandGroups(widgets, [hit.id]);
    const selection = additive
      ? hitIds.every((id) => selectedIds.includes(id))
        ? selectedIds.filter((id) => !hitIds.includes(id))
        : [...selectedIds, ...hitIds.filter((id) => !selectedIds.includes(id))]
      : selectedIds.includes(hit.id)
        ? selectedIds
        : hitIds;
    onSelect([...selection]);
    beginWidgetDrag(selection, world);
    capture(event);
    return;
  }

  if (!event.shiftKey) onSelect([]);
  dragRef.current = { mode: "marquee", start: world, additive: event.shiftKey };
  marqueeRef.current = { x: world.x, y: world.y, width: 0, height: 0 };
  setMarquee(marqueeRef.current);
  capture(event);
}


/** The table cell under a world point, or null when the point is not over a table. */
function tableCellAtPoint(
  world: { x: number; y: number },
  widgets: Parameters<typeof pick>[0],
): { frame: (typeof widgets)[number]; cell: { rowId: string; columnId: string } | null } | null {
  for (const frame of [...widgets].reverse()) {
    if (frame.type !== "frame" || frame.layout?.kind !== "table") continue;
    if (frame.layout.active === false) continue;
    const grid = layoutTable(frame, widgets);
    if (!grid) continue;
    const hit = tableHitAt(grid, world);
    if (!hit) continue;
    if (hit.kind === "cell") {
      return { frame, cell: { rowId: hit.rowId, columnId: hit.columnId } };
    }
    return { frame, cell: null };
  }
  return null;
}
