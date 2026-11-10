import type { GestureEnv } from "./gestureEnv";
import { useGestureEnv } from "./gestureEnv";
import { pointerDown } from "./gesturePointerDown";
import { pointerMove } from "./gesturePointerMove";
import { pointerUp } from "./gesturePointerUp";
import { doubleClick } from "./gestureDoubleClick";
import type { GestureDeps, Gestures } from "./gestureTypes";

export type { GestureDeps, Gestures, ConnectDraft } from "./gestureTypes";

/**
 * The pointer state machine: what a press, a drag and a release mean (ADR-059).
 *
 * The shared state lives in `useGestureEnv`, each phase of a gesture is a plain function
 * of that state and the event, and this hook only wires them together: one gesture, one
 * file to read.
 */
export function useGestures(deps: GestureDeps): Gestures {
  const env: GestureEnv = useGestureEnv(deps);
  return {
    cursor: env.cursor,
    dragPreview: env.dragPreview,
    draggedCardId: env.dragPreview?.cardId ?? null,
    hoverCell: env.hoverCell,
    tableHover: env.tableHover,
    tableRefused: env.tableRefused,
    marquee: env.marquee,
    preview: env.preview,
    dragIds: env.dragIds,
    dragGhostIds: env.dragGhostIds,
    guides: env.guides,
    hoverId: env.hoverId,
    connectDraft: env.connectDraft,
    hoverAnchor: env.hoverAnchor,
    resolve: env.widgetById,
    clearHover: () => {
      env.setHoverId(null);
      env.setHoverAnchor(null);
    },
    onPointerDown: (event) => pointerDown(env, event),
    onPointerMove: (event) => pointerMove(env, event),
    onPointerUp: () => pointerUp(env),
    onDoubleClick: (event) => doubleClick(env, event),
  };
}
