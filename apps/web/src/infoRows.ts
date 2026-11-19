import type { Widget } from "@remo/model";
import type { InfoState } from "./InfoCard";
import type { TranslationKey } from "./i18n";

/**
 * What the Info card says about one object.
 *
 * A pure function of the widget and the words: no board state, no camera, no side
 * effect. The card is a read-out, so its contents can be tested without a canvas.
 */
export function infoRows(
  widget: Widget,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): InfoState["rows"] {
  const created = widget.createdAt
    ? new Date(widget.createdAt).toLocaleString()
    : t("info.unknown");
  return [
    {
      label: t("info.size"),
      value: `${Math.round(widget.width)} × ${Math.round(widget.height)}`,
    },
    { label: t("info.position"), value: `${Math.round(widget.x)}, ${Math.round(widget.y)}` },
    { label: t("info.author"), value: widget.createdBy || t("info.unknown") },
    ...(widget.agent
      ? [
          {
            label: t("info.agent"),
            value: `${widget.agent.name}${widget.agent.skill ? ` · ${widget.agent.skill}` : ""}`,
          },
        ]
      : []),
    { label: t("info.created"), value: created },
    ...(widget.locked
      ? [
          {
            label: t("info.lock"),
            value: widget.lockedByName
              ? t("info.lockedBy", { name: widget.lockedByName })
              : t("info.lockedPlain"),
          },
        ]
      : []),
  ];
}
