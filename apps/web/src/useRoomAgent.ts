import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectorsTo, deleteWidgets, descendants, fitFrameToContents, type BoardDocument,
} from "@remo/doc";
import type { Widget } from "@remo/model";
import { api } from "./api";
import { cameraStore } from "./cameraStore";
import type { AgentThreadSummary, RoomAgentState } from "./roomAgentApi";

/**
 * The room agent state (ADR-189).
 *
 * The agent writes from the server, outside the local undo stack. Only drafts
 * from tasks submitted in this tab can take precedence over local undo.
 */
export function useRoomAgent({
  board,
  widgets,
  selectedIds,
  roomId,
  boardTitle,
  canEdit,
  accountId,
  synced,
  identityKey,
  openSettings,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: readonly string[];
  roomId: string;
  boardTitle: string;
  canEdit: boolean;
  accountId: string | null;
  synced: boolean;
  /** A sign-in or an access change must re-read the assignment. */
  identityKey: string;
  openSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkedThread, setLinkedThread] = useState<{ frameId: string; thread: AgentThreadSummary } | null>(null);
  const [state, setState] = useState<RoomAgentState | null>(null);
  const requestedTasks = useRef(new Map<string, string>());
  const seenDrafts = useRef(new Map<string, number>());
  const undoneDrafts = useRef(new Set<string>());

  const onTaskQueued = useCallback((taskId: string) => {
    if (accountId) requestedTasks.current.set(taskId, accountId);
  }, [accountId]);

  const refresh = useCallback(() => {
    void api
      .roomAgent(roomId)
      .then(setState)
      .catch(() => setState(null));
  }, [roomId]);

  useEffect(() => {
    refresh();
    if (!accountId) return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, identityKey, accountId]);

  // The document update can arrive before the HTTP response identifies its task.
  useEffect(() => {
    if (!canEdit || !synced) return;
    for (const draft of widgets) {
      if (draft.type !== "frame" || draft.agent?.skill !== "room-draft" ||
          !draft.agent.taskId || seenDrafts.current.has(draft.id)) continue;
      seenDrafts.current.set(draft.id, board.undo.undoStack.length);
    }
  }, [widgets, board, canEdit, synced]);

  const hasFrame = useCallback(
    (frameId: string) => widgets.some((widget) => widget.id === frameId && widget.type === "frame"),
    [widgets],
  );

  const canUndoFrame = useCallback((frameId: string) => {
    if (!canEdit || !accountId || undoneDrafts.current.has(frameId)) return false;
    const frame = board.readWidget(frameId);
    const taskId = frame?.agent?.taskId;
    if (frame?.type !== "frame" || frame.locked || frame.groupId ||
        frame.agent?.skill !== "room-draft" || !taskId ||
        requestedTasks.current.get(taskId) !== accountId) return false;
    // Normal frame deletion cascades to children and attached connectors.
    const children = descendants(board, frameId);
    const attached = connectorsTo(board, [frameId, ...children]);
    return [...children, ...attached].every((id) => {
      const widget = board.readWidget(id);
      return widget?.agent?.taskId === taskId && !widget.locked;
    });
  }, [board, canEdit, accountId]);

  const undoFrame = useCallback((frameId: string) => {
    if (!canUndoFrame(frameId)) return false;
    undoneDrafts.current.add(frameId);
    deleteWidgets(board, [frameId]);
    return true;
  }, [board, canUndoFrame]);

  const undoAgentDraft = useCallback(() => {
    const latest = Array.from(seenDrafts.current).reverse().find(([frameId]) => canUndoFrame(frameId));
    if (!latest) return false;
    const [frameId, depth] = latest;
    // A local edit after the draft still takes priority.
    return board.undo.undoStack.length <= depth && undoFrame(frameId);
  }, [board, canUndoFrame, undoFrame]);

  const fitFrame = useCallback((frameId: string) => {
    if (canEdit) fitFrameToContents(board, frameId);
  }, [board, canEdit]);

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
    if (chosen) return { x: chosen.x + chosen.width / 2 + 80, y: chosen.y - chosen.height / 2 };
    const camera = cameraStore.get();
    return { x: camera.x + 80, y: camera.y + 80 };
  }, [selectedIds, widgets]);

  const openPanel = () => setOpen(true);
  const close = () => {
    setOpen(false);
    setLinkedThread(null);
  };

  const openFromFrame = async (frameId: string) => {
    const response = await api.roomAgentThreads(roomId, frameId).catch(() => null);
    const thread = response?.threads[0];
    if (!thread) return false;
    setLinkedThread({ frameId, thread });
    setOpen(true);
    return true;
  };

  return {
    state,
    refresh,
    undoAgentDraft,
    openPanel,
    openFromFrame: state?.hasHistory ? openFromFrame : undefined,
    /** Header props: the avatar and its status. */
    barProps: {
      roomAgent: state?.assigned
        ? { name: state.assigned.name, enabled: state.assigned.enabled, status: state.status }
        : null,
      canAssignAgent: Boolean(state?.canAssign),
      hasRoomAgentHistory: Boolean(state?.hasHistory),
      onOpenRoomAgent: openPanel,
    },
    /** Panel props: assignment, threads and the composer. */
    panelProps: {
      open,
      boardId: roomId,
      boardTitle,
      linkedThread,
      selectedIds: [...selectedIds],
      origin,
      canEdit,
      userId: accountId,
      hasFrame,
      canUndoFrame,
      onClose: close,
      onShowFrame: showFrame,
      onUndoFrame: undoFrame,
      onFitFrame: fitFrame,
      onTaskQueued,
      onChanged: refresh,
      onOpenSettings: () => {
        close();
        openSettings();
      },
    },
  };
}
