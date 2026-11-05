import { Button, IconButton, Menu, Popover, Tooltip, readCanvasTokens } from "@remo/ui";
import {
  SHAPE_PRESETS,
  resolveColor,
  type NamedColorRole,
  type StickySize,
  type TextMarks,
} from "@remo/model";
import type { NoteDirection } from "@remo/doc";
import { useI18n } from "../i18n";
import { useMenuFocus } from "../useMenuFocus";
import { usePopover } from "../usePopover";
import { ObjectBar } from "./ObjectBar";
import {
  NoteColourWindow,
  ShapeColourWindow,
  TextColourWindow,
  shapePresetSelected,
} from "./ColourWindows";
import { colorName, isTransparent } from "./colorWindowData";
import { PanelWindow } from "./PanelWindow";
import type { StickyBarActions, StickyBarTarget } from "./stickyTypes";
import { DEFAULT_INK } from "../objectDefaults";
import { HelpLink } from "../help/HelpLink";

export type { StickyBarActions, StickyBarTarget };

type PopoverName = "colour" | "align" | "link" | "more" | null;

const SIZES: StickySize[] = ["S", "M", "L"];
const MARKS: Array<{ mark: keyof TextMarks; glyph: string; key: string }> = [
  { mark: "bold", glyph: "B", key: "sticky.bold" },
  { mark: "italic", glyph: "I", key: "sticky.italic" },
  { mark: "underline", glyph: "U", key: "sticky.underline" },
  { mark: "strike", glyph: "S", key: "sticky.strike" },
];
const DIRECTIONS: Array<{ dir: NoteDirection; glyph: string; key: string }> = [
  { dir: "left", glyph: "←", key: "sticky.addLeft" },
  { dir: "up", glyph: "↑", key: "sticky.addUp" },
  { dir: "down", glyph: "↓", key: "sticky.addDown" },
  { dir: "right", glyph: "→", key: "sticky.addRight" },
];
const ALIGN_H = ["left", "center", "right"] as const;
const ALIGN_V = ["top", "middle", "bottom"] as const;

/**
 * The object toolbar for a note, a shape or a text object (ADR-120, ADR-127).
 *
 * One row above the selected object: the colour sample │ text size │ marks │ alignment │
 * link │ More. The sample is what the object paints — the sheet, "Aa" in the shape's own
 * style, "A" with a colour bar for text — and pressing it opens the one colour window.
 * Buttons, popovers and the menu come from `@remo/ui`; this file owns the order and which
 * document action each control runs.
 */
export function StickyPanel({
  target,
  actions,
  editing,
  formatSelection,
}: {
  target: StickyBarTarget | null;
  actions: StickyBarActions;
  /** While the note is open for typing, marks apply to the selection, not the note. */
  editing: boolean;
  formatSelection: (mark: keyof TextMarks) => void;
}) {
  const { t, count } = useI18n();
  // A different object closes whatever was open for the previous one.
  const { open, setOpen, ref } = usePopover<PopoverName>(target?.id);
  const moreRef = useMenuFocus(open, "more");

  if (!target || !target.editable) return null;

  const marks = target.marks ?? {};
  const explicit = target.fontSize;
  const sizeLabel = explicit == null ? t("sticky.auto") : String(explicit);
  const shape = target.kind === "shape";
  const text = target.kind === "text";
  const note = target.kind === "note";
  // `resolveColor` maps a named legacy shade through `STICKY_COLORS`, which does not know
  // transparency; the sample must keep the stored "nothing painted" value (ADR-140).
  const fill = isTransparent(target.fillColor)
    ? "transparent"
    : resolveColor(target.fillColor);
  // A free text object with no explicit colour follows the theme's primary text; the
  // painter reads the same token, so the bar's "A" is not a second guess.
  const ink = text && !target.ink ? readCanvasTokens()["text-primary"] : target.ink;
  const shapePreset = shape
    ? SHAPE_PRESETS.find((preset) => shapePresetSelected(preset, target))
    : undefined;
  // The sample is named by the same role list the window draws, so White, Black and
  // "None" read as words on the bar too (ADR-140).
  const colourRole: NamedColorRole = shape ? "fill" : text ? "text" : "note";
  const valueName = shape
    ? shapePreset
      ? t(`preset.shape.${shapePreset.id}` as "preset.shape.plain")
      : t("color.customStyle")
    : t(
        colorName(text ? target.textColor : fill, { auto: text, role: colourRole }).key,
      );
  const colourLabel = shape
    ? `${t("shape.style")}: ${valueName}`
    : text
      ? `${t("object.text")}: ${valueName}`
      : `${t("note.sheetColour")}: ${valueName}`;

  return (
    <ObjectBar ref={ref} placement={target.placement} label={t("sticky.properties")}>
      <span className="sb-anchor">
        <Button
          variant="ghost"
          size="compact"
          className="sb-colour"
          iconEnd="chevron-down"
          aria-label={colourLabel}
          aria-haspopup="dialog"
          aria-expanded={open === "colour"}
          selected={open === "colour"}
          onClick={() => setOpen(open === "colour" ? null : "colour")}
        >
          {shape ? (
            <span
              className={
                isTransparent(fill) ? "sb-aa-preview checkerboard" : "sb-aa-preview"
              }
              aria-hidden="true"
              style={{
                background: isTransparent(fill) ? undefined : fill,
                borderColor: target.strokeColor ?? DEFAULT_INK,
                borderWidth: target.strokeWidth == null ? 2 : Math.min(target.strokeWidth, 2),
                borderStyle:
                  target.strokeStyle === "dashed"
                    ? "dashed"
                    : target.strokeStyle === "dotted"
                      ? "dotted"
                      : "solid",
                color: ink,
              }}
            >
              Aa
            </span>
          ) : text ? (
            <span className="sb-text-preview" style={{ color: ink }} aria-hidden="true">
              A<span className="sb-text-bar" />
            </span>
          ) : (
            <span
              className={
                isTransparent(fill) ? "sb-note-preview checkerboard" : "sb-note-preview"
              }
              style={{ background: isTransparent(fill) ? undefined : fill }}
              aria-hidden="true"
            />
          )}
        </Button>
        {open === "colour" &&
          (shape ? (
            <ShapeColourWindow
              target={target}
              actions={actions}
              onClose={() => setOpen(null)}
            />
          ) : text ? (
            <TextColourWindow
              target={target}
              actions={actions}
              onClose={() => setOpen(null)}
            />
          ) : (
            <NoteColourWindow
              target={target}
              actions={actions}
              onClose={() => setOpen(null)}
            />
          ))}
      </span>

      <span className="sb-divider" aria-hidden="true" />

      {note && (
        <>
          <div className="sb-group" role="group" aria-label={t("sticky.size")}>
            {SIZES.map((size) => (
              <Tooltip key={size} label={t("sticky.sizeName", { size })}>
                <Button
                  variant="ghost"
                  size="compact"
                  className="sb-size"
                  aria-label={t("sticky.sizeName", { size })}
                  selected={size === target.size}
                  onClick={() => actions.setSize(size)}
                >
                  {size}
                </Button>
              </Tooltip>
            ))}
          </div>
          <span className="sb-divider" aria-hidden="true" />
        </>
      )}

      <div className="sb-group sb-font" role="group" aria-label={t("sticky.textSize")}>
        <Tooltip
          label={
            explicit == null
              ? t("sticky.autoValue", { size: target.autoSize })
              : t("sticky.autoHint")
          }
        >
          <Button
            variant="ghost"
            size="compact"
            className="sb-auto"
            aria-label={sizeLabel}
            selected={explicit == null}
            onClick={() => actions.setFont(null)}
          >
            {sizeLabel}
          </Button>
        </Tooltip>
        <IconButton
          icon="minus"
          size="compact"
          label={t("sticky.smaller")}
          onClick={() => actions.setFont(Math.max(6, (explicit ?? target.autoSize) - 1))}
        />
        <IconButton
          icon="plus"
          size="compact"
          label={t("sticky.bigger")}
          onClick={() => actions.setFont(Math.min(96, (explicit ?? target.autoSize) + 1))}
        />
      </div>

      <span className="sb-divider" aria-hidden="true" />

      <div className="sb-group" role="group" aria-label={t("sticky.styles")}>
        {MARKS.map((entry) => {
          const name = t(entry.key as "sticky.bold");
          return (
            <Tooltip key={entry.mark} label={name}>
              <Button
                variant="ghost"
                size="compact"
                className={`sb-mark sb-${entry.mark}`}
                aria-label={name}
                selected={Boolean(marks[entry.mark])}
                onClick={() =>
                  editing ? formatSelection(entry.mark) : actions.toggleMark(entry.mark)
                }
              >
                {entry.glyph}
              </Button>
            </Tooltip>
          );
        })}
      </div>

      <span className="sb-divider" aria-hidden="true" />

      <span className="sb-anchor sb-anchor-center">
        <Button
          variant="ghost"
          size="compact"
          className="sb-icon"
          aria-label={t("sticky.alignment")}
          aria-haspopup="dialog"
          aria-expanded={open === "align"}
          selected={open === "align"}
          onClick={() => setOpen(open === "align" ? null : "align")}
        >
          <span aria-hidden="true" className="sb-align-glyph">
            {target.align === "left" ? "⇤" : target.align === "right" ? "⇥" : "↔"}
          </span>
        </Button>
        {open === "align" && (
          <PanelWindow>
            <Popover label={t("sticky.alignment")} width={124} onClose={() => setOpen(null)}>
              <div className="sb-align-grid" role="group" aria-label={t("sticky.alignment")}>
                {ALIGN_V.map((v) => (
                  <div key={v} className="sb-align-row">
                    {ALIGN_H.map((horizontal) => (
                      <Button
                        key={horizontal}
                        variant="ghost"
                        size="compact"
                        className="sb-align-cell"
                        aria-label={t("sticky.alignCell", {
                          horizontal: t(`sticky.align.${horizontal}` as "sticky.align.left"),
                          vertical: t(`sticky.align.${v}` as "sticky.align.top"),
                        })}
                        selected={target.align === horizontal && target.vAlign === v}
                        onClick={() => {
                          actions.setAlign(horizontal);
                          actions.setVAlign(v);
                          setOpen(null);
                        }}
                      >
                        <span aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            </Popover>
          </PanelWindow>
        )}
      </span>

      <span className="sb-anchor">
        <Button
          variant="ghost"
          size="compact"
          className="sb-icon"
          aria-label={t("sticky.connections")}
          aria-haspopup="dialog"
          aria-expanded={open === "link"}
          selected={open === "link"}
          onClick={() => setOpen(open === "link" ? null : "link")}
        >
          <span aria-hidden="true">＋</span>
        </Button>
        {open === "link" && (
          <PanelWindow>
            <Popover label={t("sticky.connections")} width={168} onClose={() => setOpen(null)}>
              <div className="sb-links" role="group" aria-label={t("sticky.connections")}>
                {DIRECTIONS.map((entry) => {
                  const name = t(entry.key as "sticky.addRight");
                  return (
                    <Tooltip key={entry.dir} label={name}>
                      <Button
                        variant="ghost"
                        size="compact"
                        aria-label={name}
                        onClick={() => {
                          actions.addConnected(entry.dir);
                          setOpen(null);
                        }}
                      >
                        {entry.glyph}
                      </Button>
                    </Tooltip>
                  );
                })}
              </div>
            </Popover>
          </PanelWindow>
        )}
      </span>

      <span className="sb-divider" aria-hidden="true" />

      {/* Delete lives here and nowhere else on the bar, after a separator (ADR-120). */}
      <span className="sb-more" ref={moreRef}>
        <IconButton
          icon="more"
          size="compact"
          label={t("sticky.more")}
          aria-expanded={open === "more"}
          selected={open === "more"}
          onClick={() => setOpen(open === "more" ? null : "more")}
        />
        {open === "more" && (
          <PanelWindow>
            <Menu
              label={t("sticky.more")}
              onClose={() => setOpen(null)}
              items={[
                { separator: true },
                {
                  label: t("menu.delete"),
                  icon: "trash",
                  hint: count("objects", 1),
                  danger: true,
                  onSelect: () => {
                    actions.remove();
                    setOpen(null);
                  },
                },
              ]}
            />
          </PanelWindow>
        )}
      </span>

      <HelpLink topicId="room.colours" className="sb-help" />
    </ObjectBar>
  );
}
