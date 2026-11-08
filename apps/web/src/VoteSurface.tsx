import type { Widget } from "@remo/model";
import { api } from "./api";
import { cameraStore } from "./cameraStore";
import { VotePanel } from "./VotePanel";
import type { VoteController } from "./useVoteSessions";

/**
 * The voting panel plus the one action that writes to the board (ADR-074, ADR-092).
 *
 * Publishing results is a server command: one audited, idempotent write that places a
 * text object on the board. That belongs with the panel, not with App's layout; the new
 * object's id goes back to the panel so «Показать на доске» can reveal what was written.
 */
export function VoteSurface({
  open,
  vote,
  widgets,
  canFacilitate,
  selectedIds,
  timerEndsAt,
  timerLeft,
  boardId,
  setSelectedIds,
  onReveal,
  onClose,
}: {
  open: boolean;
  vote: VoteController;
  widgets: Widget[];
  canFacilitate: boolean;
  selectedIds: readonly string[];
  timerEndsAt: string | null;
  timerLeft: number | null;
  boardId: string;
  setSelectedIds: (ids: string[]) => void;
  onReveal: (objectId: string) => void;
  onClose: () => void;
}) {
  return (
    <VotePanel
      open={open}
      vote={vote}
      widgets={widgets}
      canFacilitate={canFacilitate}
      selectedIds={selectedIds}
      timerEndsAt={timerEndsAt}
      timerLeft={timerLeft}
      onClose={onClose}
      onReveal={(objectId) => {
        onReveal(objectId);
        onClose();
      }}
      onPublish={async (sessionId, content) => {
        const camera = cameraStore.get();
        const { result } = await api.runCommand(
          boardId,
          {
            command: "board.item.create",
            input: {
              type: "text",
              x: camera.x,
              y: camera.y,
              width: 420,
              height: 240,
              content,
            },
          },
          `vote-publish-${sessionId}`,
        );
        const id = typeof result.id === "string" ? result.id : null;
        if (id) setSelectedIds([id]);
        return id;
      }}
    />
  );
}
