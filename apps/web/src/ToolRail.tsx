import { useEffect, useMemo, useRef } from "react";
import type { ShapeKind } from "@remo/model";
import { Button, IconButton, Popover, Separator, Tooltip } from "@remo/ui";
import type { IconName } from "@remo/ui";
import { useI18n, type TranslationKey } from "./i18n";
import { COLOR_WINDOW_WIDTH, ColorSwatch } from "./object-panel/ColorWindow";
import {
  defaultStickerFill,
  type NamedFillChoice,
  type NoteFillChoice,
} from "./object-panel/palette";
import { HelpLink } from "./help/HelpLink";

/** A rail tool. Select is not a creation tool; it only drops the selection. */
export type RailTool =
  | "select"
  | "sticky"
  | "text"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "connector"
  | "frame"
  | "card"
  | "comment"
  | "sticky-stack";

/**
 * The one place objects are created (ADR-119).
 *
 * The rail holds creation, selection and history; the top bar describes the board. A
 * tool with variants carries a corner marker that opens a flyout of samples (note
 * colours, shape silhouettes); a direct tool creates at once and the rail returns to
 * Select, because there is no placement mode — the canvas keeps its current gesture model.
 *
 * Every button is a design-system `IconButton` in one panel, and history is a second
 * panel: the rail is a surface of its own, not a strip of icons on the canvas edge
 * (ADR-119).
 */
export function ToolRail({
  writeBlocked,
  blockedHint,
  canComment,
  flyout,
  onFlyout,
  onSelect,
  onSticky,
  onText,
  onShape,
  onConnector,
  onFrame,
  onCard,
  onComment,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canConnect,
  canAddCard,
  noteColors,
  noteExtras,
}: {
  writeBlocked: boolean;
  /** Why creation is off (view-only or the offline queue): the tooltip says it. */
  blockedHint: string;
  canComment: boolean;
  flyout: "sticky" | "shape" | null;
  onFlyout: (next: "sticky" | "shape" | null) => void;
  onSelect: () => void;
  onSticky: (fill?: string) => void;
  onText: () => void;
  onShape: (kind: ShapeKind) => void;
  onConnector: () => void;
  onFrame: () => void;
  onCard: () => void;
  onComment: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canConnect: boolean;
  canAddCard: boolean;
  noteColors: readonly NoteFillChoice[];
  /** The named chips beside the grid — White and Black (ADR-140). */
  noteExtras: readonly NamedFillChoice[];
}) {
  const { t } = useI18n();
  const rail = useRef<HTMLDivElement | null>(null);
  const defaultFill = useMemo(() => defaultStickerFill(), []);

  useEffect(() => {
    if (!flyout) return;
    const onDown = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) onFlyout(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFlyout(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [flyout, onFlyout]);

  /**
   * One tool button, one tooltip.
   *
   * Connectivity and card placement depend on the selection, but a tool that can still
   * explain itself is not disabled (§10.2, Р1): it keeps the primary colour and answers
   * with a sentence. Only a real stop — view-only access, the offline queue — disables
   * the rail, and then the tooltip names the reason.
   */
  const tool = (options: {
    icon: IconName;
    label: TranslationKey;
    shortcut?: string;
    hint?: string;
    /** Why the tool is off when it is off for its own reason, not the board's. */
    reason?: string;
    disabled?: boolean;
    expanded?: boolean;
    onClick: () => void;
  }) => {
    const disabled = Boolean(options.disabled);
    return (
      <Tooltip
        side="right"
        label={
          disabled
            ? (options.reason ?? blockedHint)
            : options.hint
              ? `${t(options.label)} · ${options.hint}`
              : t(options.label)
        }
        shortcut={disabled || !options.shortcut ? undefined : [options.shortcut]}
      >
        <IconButton
          icon={options.icon}
          label={t(options.label)}
          iconSize={20}
          variant="ghost"
          className="tool-rail-button"
          disabled={disabled}
          selected={options.expanded}
          onClick={options.onClick}
        />
      </Tooltip>
    );
  };

  return (
    <div className="tool-rail" role="toolbar" aria-label={t("tool.rail")} ref={rail}>
      <div className="tool-rail-panel">
        {tool({
          icon: "cursor",
          label: "tool.select",
          shortcut: "V",
          expanded: true,
          onClick: onSelect,
        })}

        <Separator />

        <div className="tool-rail-item">
          {tool({
            icon: "sticky",
            label: "tool.sticky",
            shortcut: "N",
            disabled: writeBlocked,
            onClick: () => onSticky(),
          })}
          <Disclosure
            label={t("tool.stickyColors")}
            open={flyout === "sticky"}
            disabled={writeBlocked}
            onClick={() => onFlyout(flyout === "sticky" ? null : "sticky")}
          />
          {flyout === "sticky" && (
            <Popover
              title={t("tool.sticky")}
              width={COLOR_WINDOW_WIDTH}
              side="right"
              onClose={() => onFlyout(null)}
            >
              <div className="tool-flyout-palette" role="group" aria-label={t("tool.stickyColors")}>
                <div className="tool-flyout-extras">
                  {noteExtras.map((extra) => (
                    <ColorSwatch
                      key={extra.id}
                      hex={extra.value}
                      word={t(extra.key)}
                      className="tool-extra"
                      onClick={() => onSticky(extra.value)}
                    />
                  ))}
                </div>
                <div className="tool-flyout-swatches">
                  {noteColors.map((color) => (
                    <ColorSwatch
                      key={`${color.tone}-${color.level}`}
                      hex={color.hex}
                      word={t(color.key)}
                      dataHex={color.hex}
                      className={
                        color.hex === defaultFill ? "tool-swatch is-default" : "tool-swatch"
                      }
                      onClick={() => onSticky(color.hex)}
                    />
                  ))}
                </div>
              </div>
              <p className="tool-flyout-note">
                {t("tool.stickyDefault")} <HelpLink topicId="board.colours" className="help-link icon-link" />
              </p>
            </Popover>
          )}
        </div>

        {tool({
          icon: "text",
          label: "tool.text",
          shortcut: "T",
          disabled: writeBlocked,
          onClick: onText,
        })}

        <div className="tool-rail-item">
          {tool({
            icon: "shape",
            label: "tool.shape",
            shortcut: "R",
            disabled: writeBlocked,
            onClick: () => onShape("rectangle"),
          })}
          <Disclosure
            label={t("tool.shapeVariants")}
            open={flyout === "shape"}
            disabled={writeBlocked}
            onClick={() => onFlyout(flyout === "shape" ? null : "shape")}
          />
          {flyout === "shape" && (
            <Popover title={t("tool.shape")} width={232} side="right" onClose={() => onFlyout(null)}>
              <div className="tool-flyout-shapes" role="group" aria-label={t("tool.shapeVariants")}>
                <Button
                  variant="ghost"
                  size="compact"
                  className="tool-shape"
                  aria-label={t("tool.shapeRectangle")}
                  onClick={() => onShape("rectangle")}
                >
                  <span className="tool-shape-rect" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  className="tool-shape"
                  aria-label={t("tool.shapeEllipse")}
                  onClick={() => onShape("ellipse")}
                >
                  <span className="tool-shape-ellipse" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  className="tool-shape"
                  aria-label={t("tool.shapeDiamond")}
                  onClick={() => onShape("diamond")}
                >
                  <span className="tool-shape-diamond" aria-hidden="true" />
                </Button>
              </div>
            </Popover>
          )}
        </div>

        {tool({
          icon: "connector",
          label: "tool.connector",
          shortcut: "L",
          hint: canConnect ? undefined : t("tool.connectorHint"),
          disabled: writeBlocked,
          onClick: onConnector,
        })}

        {tool({
          icon: "frame",
          label: "tool.frame",
          shortcut: "F",
          disabled: writeBlocked,
          onClick: onFrame,
        })}

        {tool({
          icon: "card",
          label: "tool.card",
          shortcut: "C",
          hint: canAddCard ? undefined : t("tool.cardHint"),
          disabled: writeBlocked,
          onClick: onCard,
        })}

        <Separator />

        {tool({
          icon: "comment",
          label: "tool.comment",
          hint: canComment ? undefined : t("tool.commentHint"),
          reason: writeBlocked ? undefined : t("tool.commentHint"),
          disabled: writeBlocked || !canComment,
          onClick: onComment,
        })}
      </div>

      {/* History is separate on purpose: undo is not a creation tool (§10.2, Р3). */}
      <div className="tool-rail-panel">
        <Tooltip side="right" label={t("board.undo")}>
          <IconButton
            icon="undo"
            label={t("board.undo")}
            iconSize={20}
            className="tool-rail-button"
            disabled={writeBlocked || !canUndo}
            onClick={onUndo}
          />
        </Tooltip>
        <Tooltip side="right" label={t("board.redo")}>
          <IconButton
            icon="redo"
            label={t("board.redo")}
            iconSize={20}
            className="tool-rail-button"
            disabled={writeBlocked || !canRedo}
            onClick={onRedo}
          />
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The corner marker of a tool with variants.
 *
 * A 6 px corner in the bottom-right of the 40 px button, the way the mockup draws it:
 * it marks "more here" and keeps its hit area off the glyph, so the icon is never
 * covered and a click on the icon always creates (Р2).
 */
function Disclosure({
  label,
  open,
  disabled,
  onClick,
}: {
  label: string;
  open: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tool-rail-caret${open ? " open" : ""}`}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
