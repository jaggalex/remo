import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteWidgets, fitFrameToContents, type BoardDocument } from "@remo/doc";
import type { Widget } from "@remo/model";
import { api } from "./api";
import { cameraStore } from "./cameraStore";
import type { RoomAgentState } from "./roomAgentApi";

/**
 * The room agent state (ADR-189).
 *
 * The agent writes from the server, so its draft is not in the local undo stack. Frames
 * that appear after the first render are remembered here; ⌘Z removes the latest one when
 * no newer local edit stands in front of it.
 */
export function useRoomAgent({
  board,
  widgets,
  selectedIds,
  roomId,
  boardTitle,
  canEdit,
  identityKey,
  openSettings,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: readonly string[];
  roomId: string;
  boardTitle: string;
  canEdit: boolean;
  /** A sign-in or an access change must re-read the assignment. */
  identityKey: string;
  openSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RoomAgentState | null>(null);
  const undoStack = useRef<Array<{ frameId: string; depth: number }>>([]);
  const seenDrafts = useRef<Set<string> | null>(null);

  const refresh = useCallback(() => {
    void api
      .roomAgent(roomId)
      .then(setState)
      .catch(() => setState(null));
  }, [roomId]);

  useEffect(() => {
    refresh();
  }, [refresh, identityKey]);

  /**
   * Every agent draft frame is kept around its children, including drafts written
   * before the server learned to fit them. The repair is local and undoable; it is a
   * no-op once the frame contains everything.
   */
  useEffect(() => {
    const drafts = widgets.filter(
      (widget) =>
        widget.type === "frame" &&
        widget.agent?.skill === "room-draft" &&
        Boolean(widget.agent?.taskId),
    );
    const first = seenDrafts.current === null;
    if (first) seenDrafts.current = new Set();
    for (const draft of drafts) {
      if (first) {
        // A draft that existed before this tab opened is repaired once, so an old
        // geometry from an earlier build does not survive a reload.
        fitFrameToContents(board, draft.id);
        continue;
      }
      if (seenDrafts.current!.has(draft.id)) continue;
      seenDrafts.current!.add(draft.id);
      fitFrameToContents(board, draft.id);
      undoStack.current.push({ frameId: draft.id, depth: board.undo.undoStack.length });
      if (undoStack.current.length > 10) undoStack.current.shift();
    }
  }, [widgets, board]);

  const undoAgentDraft = useCallback(() => {
    const top = undoStack.current[undoStack.current.length - 1];
    if (!top) return false;
    if (!widgets.some((widget) => widget.id === top.frameId)) {
      undoStack.current.pop();
      return false;
    }
    // A local edit after the draft must be undone first: the stack depth is the only
    // ordering the two kinds of change share.
    if (board.undo.undoStack.length > top.depth) return false;
    undoStack.current.pop();
    deleteWidgets(board, [top.frameId]);
    return true;
  }, [board, widgets]);

  const undoFrame = useCallback((frameId: string) => deleteWidgets(board, [frameId]), [board]);
  const fitFrame = useCallback((frameId: string) => fitFrameToContents(board, frameId), [board]);

  const showFrame = useCallback(
    (frameId: string) => {
      const frame = widgets.find((widget) => widget.id === frameId);
      if (!frame) return;
      const width = Math.max(320, window.innerWidth - 160);
      const height = Math.max(240, window.innerHeight - 200);
      const zoom = Math.max(
        0.1,
        Math.min(2.5, width / Math.max(frame.width, 1), height / Math.max(frame.height, 1)),
      );
      cameraStore.set({ x: frame.x, y: frame.y, zoom }, "fit");
    },
    [widgets],
  );

  const origin = useMemo(() => {
    const chosen = selectedIds
      .map((id) => widgets.find((widget) => widget.id === id))
      .find(Boolean);
    if (chosen) return { x: chosen.x + chosen.width + 80, y: chosen.y };
    const camera = cameraStore.get();
    return { x: camera.x + 80, y: camera.y + 80 };
  }, [selectedIds, widgets]);

  const openPanel = () => setOpen(true);
  const close = () => setOpen(false);

  return {
    state,
    refresh,
    undoAgentDraft,
    openPanel,
    /** Header props: the avatar and its status. */
    barProps: {
      roomAgent: state?.assigned
        ? { name: state.assigned.name, enabled: state.assigned.enabled, status: state.status }
        : null,
      canAssignAgent: Boolean(state?.canAssign),
      onOpenRoomAgent: openPanel,
    },
    /** Panel props: assignment, threads and the composer. */
    panelProps: {
      open,
      boardId: roomId,
      boardTitle,
      selectedIds: [...selectedIds],
      origin,
      canEdit,
      onClose: close,
      onShowFrame: showFrame,
      onUndoFrame: undoFrame,
      onFitFrame: fitFrame,
      onChanged: refresh,
      onOpenSettings: () => {
        close();
        openSettings();
      },
    },
  };
}
