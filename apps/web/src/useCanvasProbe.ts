import { useEffect } from "react";
import { pick, placementAt, screenToWorld, type Camera, type KanbanLayout } from "@remo/canvas";
import type { Presence } from "@remo/doc";
import type { Widget } from "@remo/model";

import type { Gestures } from "./useGestures";
import { paintedProposal } from "./proposalStore";

/**
 * The dev-only probe that lets tests and automation drive the canvas.
 *
 * The board is two `<canvas>` elements, so there are no DOM nodes to target: this
 * exposes the camera, the widget list, the layout, the hit test and the paint counters
 * on `window.__remo` in development builds only. Production ships nothing here.
 */
export function useCanvasProbe({
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
}: {
  boardTitle: string;
  camera: Camera;
  viewport: { width: number; height: number };
  layouts: Map<string, KanbanLayout>;
  presence: Presence[];
  selectedIds: readonly string[];
  connectDraft: Gestures["connectDraft"];
  widgets: Widget[];
  textOf: (id: string) => string;
  isCardOfKanban: (widget: Widget) => boolean;
  boardRef: React.RefObject<HTMLCanvasElement | null>;
  paintStats: React.RefObject<Record<string, unknown>>;
}) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__remo = {
      /** The plan under review the overlay draws (ADR-188), read at call time. */
      get proposal() {
        return paintedProposal();
      },
      boardTitle,
      camera,
      viewport,
      layouts: [...layouts.entries()].map(([id, layout]) => ({
        id,
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        headerHeight: layout.headerHeight,
        padding: layout.padding,
        columns: layout.columns.map((c) => ({
          id: c.id,
          title: c.title,
          left: c.left,
          centerX: c.centerX,
          width: c.width,
        })),
        lanes: layout.lanes.map((l) => ({ id: l.id, title: l.title, centerY: l.centerY })),
        placements: layout.placements,
      })),
      presence: presence.map((p) => ({ ...p })),
      selectedIds: [...selectedIds],
      connectDraft: connectDraft ? { ...connectDraft } : null,
      widgets: widgets.map((w) => ({
        id: w.id,
        type: w.type,
        parentId: w.parentId,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        style: w.style ? { ...w.style } : null,
        shapeKind: w.shapeKind ?? null,
        arrow: w.arrow ?? null,
        start: w.start?.item ?? null,
        end: w.end?.item ?? null,
        text: textOf(w.id),
        link: w.link ?? null,
        status: w.status ?? null,
        assigneeId: w.assigneeId ?? null,
        assigneeName: w.assigneeName ?? null,
        startAt: w.startAt ?? null,
        dueAt: w.dueAt ?? null,
        tagIds: w.tagIds ?? null,
      })),
      /** Paint counters: shows that cursor traffic never repaints the board layer. */
      perf: () => ({ ...paintStats.current }),
      /** Mirrors the handlers: client coords → what would be hit. */
      probe(clientX: number, clientY: number) {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return { err: "no canvas" };
        const world = screenToWorld(
          camera,
          { x: 0, y: 0, width: rect.width, height: rect.height },
          { x: clientX - rect.left, y: clientY - rect.top },
        );
        const hitCard = (() => {
          for (const [kanbanId, layout] of layouts) {
            const placement = placementAt(layout, world);
            if (placement) return { kanbanId, placement };
          }
          return null;
        })();
        return {
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          world,
          card: hitCard ? { cardId: hitCard.placement.cardId } : null,
          widget: pick(widgets, world, isCardOfKanban)?.id ?? null,
        };
      },
    };
  }, [
    boardTitle,
    camera,
    connectDraft,
    isCardOfKanban,
    layouts,
    presence,
    selectedIds,
    textOf,
    viewport,
    widgets,
    boardRef,
    paintStats,
  ]);
}
