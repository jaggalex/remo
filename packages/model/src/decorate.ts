/**
 * Modelled content for widgets the source API does not describe.
 *
 * ⚠️ Provenance. Miro exposes a sticker as a bare square and a legend as
 * `unsupported`: no glyph, no caption, no reaction count, no legend text. The
 * reconstructed values below follow the same rule as the kanban matrix
 * (`reconstruct.ts`) — infer what is observable, choose something sensible
 * otherwise, and never present it as captured data. A sticker's `+1` badge and the
 * emoji seen on the live board informed the defaults; the wording of the legend is
 * ours.
 */

import type { LegendEntry, Widget } from "./types";

/** Stickers in the Kanban Framework template, in reading order. */
const STICKERS: { emoji: string; label: string; reactions: number; tint: string }[] = [
  { emoji: "😀", label: "Smile", reactions: 0, tint: "#ffdd33" },
  { emoji: "💬", label: "Let's discuss", reactions: 1, tint: "#aba3ff" },
  { emoji: "🔥", label: "Hot!", reactions: 0, tint: "#ff9f4c" },
  { emoji: "❤️", label: "Love it!", reactions: 1, tint: "#ff8080" },
  { emoji: "👍", label: "Nice", reactions: 0, tint: "#85b8ff" },
  { emoji: "🎉", label: "Celebrate", reactions: 0, tint: "#8fd14f" },
];

/** Rows of the story map's dot-voting key. */
const DOT_VOTING: LegendEntry[] = [
  { color: "#8FD14F", label: "1 dot", hint: "nice to have" },
  { color: "#FFDD33", label: "2 dots", hint: "important" },
  { color: "#F24726", label: "3 dots", hint: "do first" },
];

/** How a roadmap horizon is labelled; the source text was not observable. */
function horizonLabel(index: number): string {
  return `Horizon ${index + 1}`;
}

/**
 * Fill in modelled content for a template's stickers, legends and lane labels.
 * Returns new widget objects; anything already carrying content is left alone.
 */
export function decorateTemplateWidgets(templateKey: string, widgets: Widget[]): Widget[] {
  /** Only the roadmap stacks have a vertical plate per horizon. */
  const hasLaneLabels = templateKey.startsWith("product-roadmap");
  const stickers = widgets
    .filter((widget) => widget.type === "stamp")
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const stickerContent = new Map<string, (typeof STICKERS)[number]>();
  stickers.forEach((widget, index) => {
    const preset = STICKERS[index % STICKERS.length];
    if (preset) stickerContent.set(widget.id, preset);
  });

  // The passenger plates that name a roadmap horizon, top to bottom.
  const laneLabels = hasLaneLabels
    ? widgets
        .filter((widget) => widget.type === "unsupported" && widget.height > widget.width * 1.4)
        .sort((a, b) => a.y - b.y)
    : [];

  const laneTitles = new Map<string, string>();
  laneLabels.forEach((widget, index) => laneTitles.set(widget.id, horizonLabel(index)));

  // The remaining opaque widgets are decoration: the story map's legend and a
  // decorative panel in the kanban template.
  const smallOpaque = widgets.filter(
    (widget) => widget.type === "unsupported" && !laneTitles.has(widget.id),
  );

  return widgets.map((widget) => {
    const sticker = stickerContent.get(widget.id);
    if (sticker) {
      return {
        ...widget,
        emoji: widget.emoji ?? sticker.emoji,
        label: widget.label ?? sticker.label,
        reactions: widget.reactions ?? sticker.reactions,
        style: { ...widget.style, fillColor: widget.style?.fillColor ?? sticker.tint },
      };
    }

    const laneTitle = laneTitles.get(widget.id);
    if (laneTitle) return { ...widget, label: widget.label ?? laneTitle };

    if (smallOpaque.includes(widget) && !widget.legendTitle) {
      // The widest short plate is the dot-voting key; anything else is decoration.
      const looksLikeLegend = widget.width > widget.height && widget.height <= 200;
      return looksLikeLegend
        ? {
            ...widget,
            legendTitle: "Dot voting",
            entries: DOT_VOTING,
          }
        : { ...widget, decorative: true };
    }

    return widget;
  });
}
