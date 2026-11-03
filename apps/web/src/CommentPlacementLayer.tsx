import { useLayoutEffect, useRef, useState } from "react";
import { pick, type KanbanLayout } from "@remo/canvas";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import type { CommentAnchor } from "./commentsApi";
import { Icon } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * Pick the place a comment belongs to before writing it (ADR-114 amendment).
 *
 * The mode covers the canvas with a crosshair, highlights the object under the pointer
 * and falls back to a free point. It reports one anchor and never writes by itself.
 */
export function CommentPlacementLayer({
  camera,
  viewport,
  widgets,
  layouts,
  onPick,
  onCancel,
}: {
  camera: Camera;
  viewport: { width: number; height: number };
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  onPick: (anchor: CommentAnchor) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);

  /**
   * Escape must work on the first key after the overlay appears, and the listener must
   * survive re-renders: the board's global keydown handler runs on the same Escape and
   * flushes React synchronously, which would otherwise remove and re-add this listener
   * in the middle of the very event it needs to hear.
   */
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isCardOfKanban = (widget: Widget) =>
    widget.type === "card" && !!widget.parentId && layouts.has(widget.parentId);

  const placeAt = (clientX: number, clientY: number) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay");
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    const x = camera.x + (clientX - rect.left - rect.width / 2) / camera.zoom;
    const y = camera.y + (clientY - rect.top - rect.height / 2) / camera.zoom;

    for (const layout of layouts.values()) {
      const placement = layout.placements.find(
        (entry) =>
          x >= entry.x - entry.width / 2 &&
          x <= entry.x + entry.width / 2 &&
          y >= entry.y - entry.height / 2 &&
          y <= entry.y + entry.height / 2,
      );
      if (placement) {
        const card = widgets.find((widget) => widget.id === placement.cardId);
        if (card) {
          return {
            anchor: { kind: "widget" as const, widgetId: card.id },
            screen: { x: clientX, y: clientY },
            label: card.title || card.content || card.id,
          };
        }
      }
    }

    const hit = pick(widgets, { x, y }, isCardOfKanban);
    if (hit && hit.type !== "connector") {
      return {
        anchor: { kind: "widget" as const, widgetId: hit.id },
        screen: { x: clientX, y: clientY },
        label: hit.title || hit.content || hit.type,
      };
    }
    return {
      anchor: { kind: "point" as const, x, y },
      screen: { x: clientX, y: clientY },
      label: t("comments.point"),
    };
  };

  return (
    <div
      className="comment-placement"
      role="application"
      aria-label={t("comments.placeHint")}
      onClick={(event) => {
        const found = placeAt(event.clientX, event.clientY);
        if (found) onPick(found.anchor);
      }}
      onPointerMove={(event) => {
        const found = placeAt(event.clientX, event.clientY);
        if (found) setHover({ ...found.screen, label: found.label });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="comment-placement-hint">{t("comments.placeHint")}</div>
      {hover && (
        <span
          className="comment-placement-target"
          style={{ left: hover.x, top: hover.y }}
        >
          <Icon name="comment" size={14} /> {hover.label}
        </span>
      )}
      <div className="comment-placement-cross" style={{ left: hover?.x, top: hover?.y }} />
      <span className="sr-only">{viewport.width}×{viewport.height}</span>
    </div>
  );
}
