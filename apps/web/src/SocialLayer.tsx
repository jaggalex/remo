import type { BoardConnection, Presence } from "@remo/doc";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { CommentsPanel } from "./CommentsPanel";
import { ReactionsLayer } from "./ReactionsLayer";

/**
 * The two social surfaces that live beside the canvas: comments and live reactions.
 *
 * Their entry points are in the header (ADR-119, П1), so both are
 * controlled from the app: the panel by an open flag, the bursts by the last reaction
 * picked in the facilitation menu.
 */
export function SocialLayer({
  connection,
  presence,
  camera,
  viewport,
  layouts,
  widgets,
  selectedIds,
  meId,
  canComment,
  canManage,
  commentRequest,
  onSelectWidget,
  commentsOpen,
  onCommentsOpen,
  onCommentsUnread,
  reactionRequest,
}: {
  connection: BoardConnection | null;
  presence: Presence[];
  camera: Camera;
  viewport: { width: number; height: number };
  layouts: Map<string, KanbanLayout>;
  widgets: Widget[];
  selectedIds: readonly string[];
  meId: string | null;
  canComment: boolean;
  canManage: boolean;
  commentRequest: number;
  onSelectWidget: (ids: string[]) => void;
  commentsOpen: boolean;
  onCommentsOpen: (value: boolean) => void;
  onCommentsUnread: (value: number) => void;
  reactionRequest: { emoji: string; at: number } | null;
}) {
  return (
    <>
      <ReactionsLayer
        connection={connection}
        presence={presence}
        camera={camera}
        viewport={viewport}
        widgets={widgets}
        selectedIds={selectedIds}
        layouts={layouts}
        request={reactionRequest}
      />
      <CommentsPanel
        connection={connection}
        presence={presence}
        widgets={widgets}
        viewport={viewport}
        camera={camera}
        layouts={layouts}
        selectedIds={selectedIds}
        meId={meId}
        canComment={canComment}
        canManage={canManage}
        commentRequest={commentRequest}
        onSelectWidget={onSelectWidget}
        open={commentsOpen}
        onOpen={onCommentsOpen}
        onUnread={onCommentsUnread}
      />
    </>
  );
}
