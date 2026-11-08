import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Popover, Segmented, Tooltip } from "@remo/ui";
import {
  NAMED_COLORS,
  colorExtras,
  colorsForLevels,
  TONES,
  type ColorLevel,
  type NamedColorRole,
} from "@remo/model";
import { useI18n } from "../i18n";
import {
  colorName,
  colorWord,
  inkExtraIds,
  inkOption,
  namedColorWord,
  markedColor,
  normalizeColor,
  TEXT_INKS,
} from "./colorWindowData";
import { PanelWindow } from "./PanelWindow";

/**
 * The one colour window (ADR-127).
 *
 * Every object bar shows one sample of what it paints; pressing it opens this frame. The
 * roles inside are stacked and labelled in words, the grid is always the same seven tonal
 * columns, and a pick writes and closes nothing else — no second popover over the first.
 * The window is composed of design-system `Popover` and `Segmented`; the app owns the
 * roles and which document action a swatch runs.
 */
/**
 * The width that fits seven 34 px columns plus one named column at the same gap.
 *
 * The popover body has 16 px of padding on each side and a 1 px border, so 338 − 34 = 304
 * for the body: 34 named + 4 gap + (7 × 34 + 6 × 4) grid + 4 padding. A narrower window
 * squeezes the grid and the named swatches stop being the same square (ADR-140).
 */
export const COLOR_WINDOW_WIDTH = 354;

export function ColorWindow({
  title,
  width = COLOR_WINDOW_WIDTH,
  onClose,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <PanelWindow>
      <Popover title={title} width={width} onClose={onClose}>
        <div className="cw">{children}</div>
      </Popover>
    </PanelWindow>
  );
}

/** A hairline between roles, as in the mockups. */
export function ColorRule() {
  return <div className="cw-rule" aria-hidden="true" />;
}

/** One square swatch: a grid value or a named value beside it (ADR-127, ADR-140). */
export type SwatchKind = "color" | "transparent" | "none" | "auto";

/**
 * The one swatch of the colour window and the rail.
 *
 * A grid entry and a named value have the same square, radius and gap, so White, Black and
 * None read as members of the same palette rather than as buttons with words (ADR-140).
 * A fill that paints nothing is a checkerboard; a border or a line that is absent crosses
 * that checkerboard, which is the difference between "Transparent" and "None".
 */
export function ColorSwatch({
  hex,
  word,
  kind = "color",
  selected,
  radio = false,
  tabIndex,
  dataHex,
  className,
  onClick,
}: {
  /** The painted value; unused by the checkerboard and Auto kinds. */
  hex?: string;
  /** The word in both the accessible name and the native tooltip. */
  word: string;
  kind?: SwatchKind;
  selected?: boolean;
  /** A swatch inside a radiogroup is a radio; a named value beside it is a toggle. */
  radio?: boolean;
  tabIndex?: number;
  dataHex?: string;
  className?: string;
  onClick: () => void;
}) {
  const classes = [
    "cw-swatch",
    kind === "transparent" || kind === "none" ? "checkerboard" : "",
    kind === "none" ? "is-none" : "",
    kind === "auto" ? "is-auto" : "",
    selected ? "is-selected" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties | undefined =
    kind === "color" && hex ? { background: hex } : undefined;
  const common = {
    type: "button" as const,
    className: classes,
    "aria-label": word,
    title: word,
    "data-hex": dataHex,
    style,
    onClick,
  };

  return (
    <Tooltip label={word}>
      {radio ? (
        <button {...common} role="radio" aria-checked={Boolean(selected)} tabIndex={tabIndex} />
      ) : (
        <button {...common} aria-pressed={selected} />
      )}
    </Tooltip>
  );
}

/**
 * One role: its word, the current value's name, the grid and — for the main role — the
 * 1–7 key hints.
 *
 * `showKeys` belongs to the role the number keys paint: fill for a note, shape and a
 * multi-selection, the line for a connector, the ink for free text. A border row has no
 * hints because a digit changes the main colour, not the border (ADR-127).
 */
export function ColorGridSection({
  label,
  ariaLabel,
  levels,
  value,
  mixed,
  role,
  auto,
  onAuto,
  onPick,
  showKeys,
  children,
}: {
  label?: string;
  ariaLabel: string;
  levels: readonly ColorLevel[];
  value: string | null | undefined;
  mixed?: boolean;
  /** The role whose named values are drawn as swatches beside the grid (ADR-140). */
  role?: NamedColorRole;
  /** An absent value means "Auto", which a free text object can be. */
  auto?: boolean;
  /** Writes "no explicit colour"; the Auto swatch is drawn only when this is given. */
  onAuto?: () => void;
  onPick: (hex: string) => void;
  showKeys?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const named = role ? colorExtras(role) : [];
  const name = colorName(value, { mixed, auto, role });
  const selected = mixed ? null : markedColor(value);
  const colors = colorsForLevels(levels);
  const marked = colors.findIndex((color) => color.hex === selected);
  const tabStop = marked < 0 ? 0 : marked;
  const own = !mixed && name.key === "color.own";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? TONES.length
            : event.key === "ArrowUp"
              ? -TONES.length
              : 0;
    if (!step) return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = ((current < 0 ? tabStop : current) + step + buttons.length) % buttons.length;
    const button = buttons[next];
    if (!button) return;
    button.focus();
    const hex = button.dataset.hex;
    if (hex) onPick(hex);
  };

  return (
    <section className="cw-section">
      <div className="cw-head">
        {label && <span className="cw-label">{label}</span>}
        {!own && (
          <span className="cw-value" title={name.detail}>
            {t(name.key)}
          </span>
        )}
      </div>
      <div className="cw-body">
        {(onAuto || named.length > 0) && (
          <div className="cw-extras">
            {onAuto && (
              <ColorSwatch
                word={t("sticky.auto")}
                kind="auto"
                selected={Boolean(auto) && !mixed && selected === null}
                onClick={onAuto}
              />
            )}
            {named.map((id) => {
              const word = t(namedColorWord(id, role));
              const stored = NAMED_COLORS[id];
              return (
                <ColorSwatch
                  key={id}
                  hex={stored}
                  word={word}
                  kind={
                    id === "none" ? (role === "fill" ? "transparent" : "none") : "color"
                  }
                  selected={!mixed && selected === stored}
                  onClick={() => onPick(stored)}
                />
              );
            })}
          </div>
        )}
        <div className="cw-grid-stack">
          <div
            className="cw-grid"
            role="radiogroup"
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
          >
            {colors.map((color, index) => {
              const word = t(colorWord(color.hex));
              return (
                <ColorSwatch
                  key={`${color.tone}-${color.level}`}
                  hex={color.hex}
                  word={word}
                  radio
                  selected={color.hex === selected}
                  tabIndex={index === tabStop ? 0 : -1}
                  dataHex={color.hex}
                  onClick={() => onPick(color.hex)}
                />
              );
            })}
          </div>
          {showKeys && (
            <div className="cw-keys" aria-hidden="true">
              {TONES.map((tone, index) => (
                <span key={tone}>{index + 1}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {mixed && <p className="cw-hint">{t("color.mixedHint")}</p>}
      {own && (
        <p className="cw-hint">
          {t("color.own")}
          {name.detail ? ` ${name.detail}` : ""} · {t("color.ownHint")}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * The ink of a filled object: Auto, Dark, Black or White, in words (ADR-127, ADR-140).
 *
 * Auto is the absence of `textColor`, so it is a value of this control rather than a
 * colour; an ink from the old palette is named "Custom colour" with no segment pressed.
 * Black joins the control as a named value, but White is not repeated as a chip: the
 * segment already says it.
 */
export function InkSection({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  hint?: string;
}) {
  const { t } = useI18n();
  const option = inkOption(value);
  const showBlack = inkExtraIds().includes("black");
  const nameKey =
    option === "auto"
      ? "sticky.auto"
      : option === "dark"
        ? "color.inkDark"
        : option === "black"
          ? namedColorWord("black")
          : option === "white"
            ? "color.inkWhite"
            : "color.own";

  return (
    <section className="cw-section">
      <div className="cw-head">
        <span className="cw-label">{label}</span>
        {option !== "own" && <span className="cw-value">{t(nameKey)}</span>}
      </div>
      <Segmented
        label={label}
        value={option}
        options={[
          {
            value: "auto",
            label: (
              <>
                <span className="cw-ink-chip is-auto" aria-hidden="true" />
                {t("sticky.auto")}
              </>
            ),
          },
          {
            value: "dark",
            label: (
              <>
                <span
                  className="cw-ink-chip"
                  style={{ background: TEXT_INKS.dark }}
                  aria-hidden="true"
                />
                {t("color.inkDark")}
              </>
            ),
          },
          ...(showBlack
            ? [
                {
                  value: "black",
                  label: (
                    <>
                      <span
                        className="cw-ink-chip"
                        style={{ background: TEXT_INKS.black }}
                        aria-hidden="true"
                      />
                      {t(namedColorWord("black"))}
                    </>
                  ),
                },
              ]
            : []),
          {
            value: "white",
            label: (
              <>
                <span
                  className="cw-ink-chip"
                  style={{ background: TEXT_INKS.white }}
                  aria-hidden="true"
                />
                {t("color.inkWhite")}
              </>
            ),
          },
        ]}
        onChange={(next) =>
          onChange(
            next === "auto"
              ? null
              : next === "dark"
                ? TEXT_INKS.dark
                : next === "black"
                  ? TEXT_INKS.black
                  : TEXT_INKS.white,
          )
        }
      />
      {hint && <p className="cw-hint">{hint}</p>}
      {option === "own" && (
        <p className="cw-hint">
          {t("color.own")}
          {normalizeColor(value) ? ` ${normalizeColor(value)}` : ""} · {t("color.ownHint")}
        </p>
      )}
    </section>
  );
}
