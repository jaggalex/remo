/**
 * Creation commands: the rail's actions and the objects they add (ADR-119).
 *
 * Split out of `useBoardCommands` so the style and clipboard halves stay readable and
 * each new creation tool has one obvious home.
 */
import { useCallback, useMemo, useRef } from "react";
import type { BoardDocument } from "@remo/doc";
import { addCard, addColumn, createShape, createSticky, createWidget } from "@remo/doc";
import {
  canConnect,
  DEFAULT_TEXT_COLOR,
  newId,
  type KanbanState,
  type ShapeKind,
  type Widget,
} from "@remo/model";
import type { Camera } from "@remo/canvas";
import { cardTargetFor } from "./cardTarget";
import { defaultStickerFill } from "./object-panel/palette";
import type { BoardSettings } from "./settings";

/** A new card's box, matched to the template the matrix was captured from. */
const CARD_WIDTH = 422.08;
const CARD_HEIGHT = 79.14;

export function useBoardCreation({
  board,
  widgets,
  selectedIds,
  kanbanStates,
  camera,
  settings,
  setSelectedIds,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: string[];
  kanbanStates: Record<string, KanbanState>;
  camera: Camera;
  settings: BoardSettings;
  setSelectedIds: (ids: string[]) => void;
}) {
  /** Cascade counter so consecutive additions do not land on one point. */
  const placedCount = useRef(0);

  const onAddCard = useCallback(
    (kanbanId: string, columnId: string, swimlaneId: string) => {
      const id = newId("card");
      addCard(
        board,
        kanbanId,
        id,
        {
          id,
          type: "card",
          parentId: kanbanId,
          x: 0,
          y: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          title: "",
        },
        columnId,
        swimlaneId,
      );
      setSelectedIds([id]);
    },
    [board],
  );

  const onAddColumn = useCallback(
    (kanbanId: string) => addColumn(board, kanbanId),
    [board],
  );

  /** New objects land near the middle of the view, cascading so they do not stack. */
  const nextSpot = useCallback(() => {
    const step = placedCount.current % 6;
    placedCount.current += 1;
    return { x: camera.x - 200 + step * 40, y: camera.y - 150 + step * 40 };
  }, [camera.x, camera.y]);

  const addSticky = useCallback(
    (fill?: string): string => {
      const id = newId("sticky");
      // A note created with no choice gets the design system's yellow, so the first chip
      // in its bar is the colour it actually has. Existing notes keep their hex (ADR-120).
      createSticky(board, id, nextSpot(), fill ?? defaultStickerFill());
      setSelectedIds([id]);
      return id;
    },
    [board, nextSpot, setSelectedIds],
  );

  /** Shift+N: a small pad of notes, laid out in a grid and selected together. */
  const addStickyStack = useCallback(
    (count = 5) => {
      const spot = nextSpot();
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const id = newId("sticky");
        const column = index % 3;
        const row = Math.floor(index / 3);
        createSticky(
          board,
          id,
          { x: spot.x + column * 220, y: spot.y + row * 220 },
          defaultStickerFill(),
        );
        ids.push(id);
      }
      setSelectedIds(ids);
    },
    [board, nextSpot, setSelectedIds],
  );

  /** A text object: the rail creates it empty and the editor opens over it. */
  const addText = useCallback((): string => {
    const id = newId("text");
    const spot = nextSpot();
    createWidget(board, {
      id,
      type: "text",
      parentId: null,
      x: spot.x,
      y: spot.y,
      width: 360,
      height: 120,
      // Greys 600 is a swatch in the text window, so the first open rings it; the old
      // near-black fallback was outside the palette (ADR-129).
      style: { color: DEFAULT_TEXT_COLOR },
    });
    setSelectedIds([id]);
    return id;
  }, [board, nextSpot, setSelectedIds]);

  /** A card lives in a kanban cell, so the rail needs a target or an explanation. */
  const addCardFromSelection = useCallback((): boolean => {
    const target = cardTargetFor(widgets, selectedIds, kanbanStates);
    if (!target) return false;
    onAddCard(target.kanbanId, target.columnId, target.swimlaneId);
    return true;
  }, [widgets, selectedIds, kanbanStates, onAddCard]);

  /** Exactly two connectable objects: the rail's connector tool needs nothing else. */
  const canJoinSelection = useMemo(
    () =>
      selectedIds.length === 2 &&
      selectedIds.every((id) => {
        const widget = widgets.find((entry) => entry.id === id);
        return widget ? canConnect(widget) : false;
      }),
    [selectedIds, widgets],
  );

  const addFrame = useCallback(
    (title: string) => {
      const id = newId("frame");
      const spot = nextSpot();
      createWidget(board, {
        id,
        type: "frame",
        parentId: null,
        x: spot.x,
        y: spot.y,
        width: 640,
        height: 420,
        title,
      });
      setSelectedIds([id]);
      return id;
    },
    [board, nextSpot],
  );

  const addShape = useCallback(
    (kind: ShapeKind) => {
      const id = newId("shape");
      createShape(board, id, kind, nextSpot(), {
        fillColor: settings.shapes.fill,
        strokeColor: settings.shapes.stroke,
        strokeWidth: settings.shapes.strokeWidth,
      });
      setSelectedIds([id]);
    },
    [board, nextSpot],
  );

  return {
    onAddCard,
    onAddColumn,
    nextSpot,
    addSticky,
    addStickyStack,
    addText,
    addCardFromSelection,
    canJoinSelection,
    addFrame,
    addShape,
  };
}
