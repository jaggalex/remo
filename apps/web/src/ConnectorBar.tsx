import { Button, IconButton, Menu, Popover, Segmented } from "@remo/ui";
import { LINE_PRESETS, type ConnectorRouting, type LinePreset } from "@remo/model";
import { usePopover } from "./usePopover";
import { useMenuFocus } from "./useMenuFocus";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import { ObjectBar } from "./object-panel/ObjectBar";
import {
  ColorGridSection,
  ColorRule,
  ColorWindow,
} from "./object-panel/ColorWindow";
import { colorName } from "./object-panel/colorWindowData";
import { PanelWindow } from "./object-panel/PanelWindow";

export interface ConnectorBarTarget {
  id: string;
  /** Screen-space box of the line, so the bar can sit just above it. */
  placement: { left: number; top: number };
  routing: ConnectorRouting;
  strokeStyle: "normal" | "dashed" | "dotted";
  strokeWidth: number;
  strokeColor: string;
  arrow: "none" | "end" | "both" | "start";
  /** Whether the line already carries text; the button reads as pressed if so. */
  hasLabel: boolean;
  /** Explicit label size, or null for the default. */
  fontSize: number | null;
  /** Explicit label colour; absent means the default ink. */
  textColor?: string;
  /** The colour the label is drawn in right now. */
  ink: string;
}

export interface ConnectorBarActions {
  setRouting: (routing: ConnectorRouting) => void;
  setWidth: (width: number) => void;
  setDash: (style: "normal" | "dashed" | "dotted") => void;
  setColor: (color: string) => void;
  setArrow: (arrow: "none" | "end" | "both" | "start") => void;
  swapEnds: () => void;
  /** Label size; `null` is the default. */
  setFont: (size: number | null) => void;
  setInk: (color: string | null) => void;
  /**
   * One chip, one line, one undo step: colour, width, dash and the arrow head are
   * written in one transaction (ADR-120).
   */
  applyPreset: (preset: LinePreset) => void;
  remove: () => void;
}

type Open = "type" | "colour" | "more" | null;

const ROUTINGS = [
  { value: "straight", label: "line.straight" },
  { value: "elbow", label: "line.elbowed" },
  { value: "curved", label: "line.curved" },
] as const;

const DASHES = [
  { value: "normal", label: "line.solid" },
  { value: "dashed", label: "line.dashed" },
  { value: "dotted", label: "line.dotted" },
] as const;

const WIDTHS = [
  { value: 1, label: "line.thin" },
  { value: 2, label: "line.normal" },
  { value: 4, label: "line.thick" },
] as const;

/**
 * The connector toolbar (ADR-120, ADR-127).
 *
 * One sample of the line itself │ ends │ label │ More. The sample is the line's own colour,
 * width, dash and arrow head; pressing it opens the one colour window, where the five line
 * presets, the colour, width and dash live. Form, ends and the label stay on the bar: they
 * are not colour, and the mockup keeps them there too.
 */
export function ConnectorBar({
  target,
  actions,
  onEditLabel,
}: {
  target: ConnectorBarTarget | null;
  actions: ConnectorBarActions;
  /** Opens the label editor; editing is the canvas's business, not a doc command. */
  onEditLabel: () => void;
}) {
  const { t, count } = useI18n();
  const { open, setOpen, ref } = usePopover<Open>(target?.id);
  const moreRef = useMenuFocus(open, "more");

  if (!target) return null;

  const routing = ROUTINGS.find((entry) => entry.value === target.routing) ?? ROUTINGS[0];
  const startOn = target.arrow === "start" || target.arrow === "both";
  const endOn = target.arrow === "end" || target.arrow === "both";
  const setArrow = (start: boolean, end: boolean) =>
    actions.setArrow(start && end ? "both" : start ? "start" : end ? "end" : "none");
  const preset = LINE_PRESETS.find((entry) => linePresetSelected(entry, target));
  const colourLabel = `${t("line.colour")}: ${t(
    colorName(target.strokeColor, { role: "stroke" }).key,
  )}`;

  return (
    <ObjectBar
      ref={ref}
      placement={target.placement}
      label={t("line.properties")}
      className="connector-bar"
    >
      <span className="sb-anchor">
        <Button
          variant="secondary"
          size="compact"
          iconEnd="chevron-down"
          aria-label={t("line.type")}
          title={t("line.type")}
          aria-expanded={open === "type"}
          onClick={() => setOpen(open === "type" ? null : "type")}
        >
          {t(routing.label)}
        </Button>
        {open === "type" && (
          <PanelWindow>
            <Popover title={t("line.type")} width={320} onClose={() => setOpen(null)}>
              <Segmented
                label={t("line.type")}
                value={target.routing}
                options={ROUTINGS.map((entry) => ({
                  value: entry.value,
                  label: t(entry.label),
                }))}
                onChange={(value) => actions.setRouting(value as ConnectorRouting)}
              />
            </Popover>
          </PanelWindow>
        )}
      </span>

      <span className="sb-divider" aria-hidden="true" />

      <span className="sb-anchor">
        <Button
          variant="ghost"
          size="compact"
          className="sb-colour sb-line-colour"
          iconEnd="chevron-down"
          aria-label={colourLabel}
          title={colourLabel}
          aria-haspopup="dialog"
          aria-expanded={open === "colour"}
          selected={open === "colour"}
          onClick={() => setOpen(open === "colour" ? null : "colour")}
        >
          <LineSample target={target} />
        </Button>
        {open === "colour" && (
          <ColorWindow title={t("line.colour")} onClose={() => setOpen(null)}>
            <section className="cw-section">
              <div className="cw-head">
                <span className="cw-label">{t("color.presets")}</span>
                <span className="cw-value">
                  {preset
                    ? t(`preset.line.${preset.id}` as "preset.line.plain")
                    : t("color.customStyle")}
                </span>
              </div>
              <div className="cw-presets" role="group" aria-label={t("color.presets")}>
                {LINE_PRESETS.map((entry) => {
                  const name = t(`preset.line.${entry.id}` as "preset.line.plain");
                  return (
                    <Button
                      key={entry.id}
                      variant="ghost"
                      size="compact"
                      className={
                        entry.id === preset?.id ? "cw-preset is-selected" : "cw-preset"
                      }
                      aria-label={name}
                      selected={entry.id === preset?.id}
                      title={name}
                      onClick={() => actions.applyPreset(entry)}
                    >
                      <LineChip preset={entry} />
                    </Button>
                  );
                })}
              </div>
            </section>
            <ColorRule />
            <ColorGridSection
              label={t("line.colour")}
              ariaLabel={t("line.colour")}
              levels={[600]}
              value={target.strokeColor}
              role="stroke"
              onPick={actions.setColor}
              showKeys
            >
              <div className="cw-row">
                <Segmented
                  label={t("line.widthLabel")}
                  value={String(target.strokeWidth)}
                  options={WIDTHS.map((entry) => ({
                    value: String(entry.value),
                    label: String(entry.value),
                    ariaLabel: `${t(entry.label)} ${entry.value}`,
                  }))}
                  onChange={(value) => actions.setWidth(Number(value))}
                />
                <Segmented
                  label={t("line.dash")}
                  value={target.strokeStyle}
                  options={DASHES.map((entry) => ({
                    value: entry.value,
                    label: <span className={`sb-dash ${entry.value}`} aria-hidden="true" />,
                    ariaLabel: t(entry.label),
                  }))}
                  onChange={(value) =>
                    actions.setDash(value as "normal" | "dashed" | "dotted")
                  }
                />
              </div>
            </ColorGridSection>
            {target.hasLabel && (
              <>
                <ColorRule />
                <ColorGridSection
                  label={t("line.labelInk")}
                  ariaLabel={t("line.labelInk")}
                  levels={[600]}
                  value={target.textColor ?? null}
                  role="text"
                  auto
                  onAuto={() => actions.setInk(null)}
                  onPick={actions.setInk}
                />
              </>
            )}
          </ColorWindow>
        )}
      </span>

      <span className="sb-divider" aria-hidden="true" />

      <span className="sb-role" role="group" aria-label={t("line.ends")}>
        <span className="sb-role-label">{t("line.ends")}</span>
        <Button
          variant="ghost"
          size="compact"
          aria-label={t("line.start")}
          title={t("line.start")}
          selected={startOn}
          onClick={() => setArrow(!startOn, endOn)}
        >
          <StartEndGlyph at="start" />
        </Button>
        <Button
          variant="ghost"
          size="compact"
          aria-label={t("line.swap")}
          title={t("line.swap")}
          onClick={actions.swapEnds}
        >
          <SwapGlyph />
        </Button>
        <Button
          variant="ghost"
          size="compact"
          aria-label={t("line.end")}
          title={t("line.end")}
          selected={endOn}
          onClick={() => setArrow(startOn, !endOn)}
        >
          <StartEndGlyph at="end" />
        </Button>
      </span>

      <span className="sb-divider" aria-hidden="true" />

      <Button
        variant="ghost"
        size="compact"
        aria-label={t("line.label")}
        title={t("line.label")}
        selected={target.hasLabel}
        onClick={onEditLabel}
      >
        Aa
      </Button>

      {target.hasLabel && (
        <div className="sb-group sb-font" role="group" aria-label={t("line.labelSize")}>
          <Button
            variant="ghost"
            size="compact"
            aria-label={t("line.labelDefault")}
            title={t("line.labelDefault")}
            selected={target.fontSize == null}
            onClick={() => actions.setFont(null)}
          >
            {target.fontSize ?? t("sticky.auto")}
          </Button>
          <IconButton
            icon="minus"
            size="compact"
            label={t("sticky.smaller")}
            onClick={() => actions.setFont(Math.max(6, (target.fontSize ?? 13) - 1))}
          />
          <IconButton
            icon="plus"
            size="compact"
            label={t("sticky.bigger")}
            onClick={() => actions.setFont(Math.min(96, (target.fontSize ?? 13) + 1))}
          />
        </div>
      )}

      <span className="sb-divider" aria-hidden="true" />

      <HelpLink topicId="connectors.waypoints" className="sb-help" />

      {/* Delete lives here and nowhere else on the bar, after a separator (ADR-120). */}
      <span className="sb-more" ref={moreRef}>
        <IconButton
          icon="more"
          size="compact"
          label={t("line.more")}
          aria-expanded={open === "more"}
          selected={open === "more"}
          onClick={() => setOpen(open === "more" ? null : "more")}
        />
        {open === "more" && (
          <PanelWindow>
            <Menu
              label={t("line.more")}
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
    </ObjectBar>
  );
}

/**
 * A preset chip is the line it produces: its colour, its width, its dash and the arrow
 * head at the end (ADR-120). A line recoloured by hand matches nothing, which is honest.
 */
function linePresetSelected(preset: LinePreset, target: ConnectorBarTarget): boolean {
  return (
    target.strokeColor.toLowerCase() === preset.color.toLowerCase() &&
    target.strokeWidth === preset.width &&
    target.strokeStyle === preset.dash &&
    target.arrow === preset.arrow
  );
}

const DASH_ARRAY: Record<LinePreset["dash"], string | undefined> = {
  normal: undefined,
  dashed: "4 3",
  dotted: "1 3",
};

function LineChip({ preset }: { preset: LinePreset }) {
  return (
    <svg className="sb-line-chip" width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
      <line
        x1="1"
        y1="5"
        x2="22"
        y2="5"
        stroke={preset.color}
        strokeWidth={preset.width}
        strokeDasharray={DASH_ARRAY[preset.dash]}
        strokeLinecap={preset.dash === "dotted" ? "round" : "butt"}
      />
      {preset.arrow === "end" || preset.arrow === "both" ? (
        <path d="M22 1.5 29 5 22 8.5z" fill={preset.color} />
      ) : null}
      {preset.arrow === "start" || preset.arrow === "both" ? (
        <path d="M8 1.5 1 5 8 8.5z" fill={preset.color} />
      ) : null}
    </svg>
  );
}

/** The bar's sample: the line as it is painted, head included. */
function LineSample({ target }: { target: ConnectorBarTarget }) {
  const width = Math.min(target.strokeWidth, 4);
  const dash = target.strokeStyle === "normal" ? undefined : target.strokeStyle === "dashed" ? "4 3" : "1 3";
  const start = target.arrow === "start" || target.arrow === "both";
  const end = target.arrow === "end" || target.arrow === "both";
  return (
    <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">
      <path
        d="M2 6h22"
        stroke={target.strokeColor}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
        fill="none"
      />
      {end && <path d="M22 2 29 6l-7 4z" fill={target.strokeColor} />}
      {start && <path d="M8 2 1 6l7 4z" fill={target.strokeColor} />}
    </svg>
  );
}

/** Which end carries the head: a diagram, not a word, so the pair reads at a glance. */
function StartEndGlyph({ at }: { at: "start" | "end" }) {
  return (
    <svg className="sb-end-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {at === "start" ? (
        <path d="M14 8H4M7 5 4 8l3 3" />
      ) : (
        <path d="M2 8h10M9 5l3 3-3 3" />
      )}
    </svg>
  );
}

function SwapGlyph() {
  return (
    <svg className="sb-end-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" />
    </svg>
  );
}
