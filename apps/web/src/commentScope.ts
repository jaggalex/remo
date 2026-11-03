import type { Widget } from "@remo/model";
import type { CommentThread } from "./commentsApi";

/**
 * Which threads belong to the slide being presented (ADR-114).
 *
 * The frame is a container, not a tag: a widget anchor belongs to the frame through its
 * `parentId` chain, a point anchor by geometry. The same rule is used for the pin list
 * and the panel, so a visible pin always has a row.
 */
export function threadInFrame(
  thread: CommentThread,
  frameId: string | null,
  widgets: readonly Widget[],
): boolean {
  if (!frameId) return true;
  const frame = widgets.find((widget) => widget.id === frameId);
  if (!frame || frame.type !== "frame") return true;

  const anchor = thread.anchor;
  if (anchor.kind === "point") {
    return (
      anchor.x >= frame.x - frame.width / 2 &&
      anchor.x <= frame.x + frame.width / 2 &&
      anchor.y >= frame.y - frame.height / 2 &&
      anchor.y <= frame.y + frame.height / 2
    );
  }

  let widget = widgets.find((entry) => entry.id === anchor.widgetId);
  const seen = new Set<string>();
  while (widget && !seen.has(widget.id)) {
    if (widget.id === frameId) return true;
    seen.add(widget.id);
    widget = widget.parentId
      ? widgets.find((entry) => entry.id === widget?.parentId)
      : undefined;
  }
  return false;
}
