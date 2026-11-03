import {
  NAMED_COLORS,
  TONES,
  TONE_LEVELS,
  colorExtras,
  isPaletteColor,
  matchColor,
  type ColorLevel,
  type ColorTone,
  type NamedColorId,
  type NamedColorRole,
} from "@remo/model";
import type { TranslationKey } from "../i18n";

/**
 * Pure decisions of the one colour window (ADR-127).
 *
 * The window draws what the model stores, so the words and the arithmetic stay here and
 * are tested without a browser: which colour a value is called, which row a key press
 * writes, and which of "Auto / Dark / Black / White" the ink currently is. The component next door
 * only renders these answers; that is what keeps every swatch (note, shape, line, text,
 * multi-selection) behaving the same.
 */

/** The explicit inks a filled object offers beside Auto (ADR-127, ADR-140). */
export const TEXT_INKS = {
  dark: "#1d1b1a",
  black: NAMED_COLORS.black,
  white: NAMED_COLORS.white,
} as const;

/**
 * The i18n key naming a palette value.
 *
 * One key per hex serves the window, the rail's flyout and the object bar's sample, so
 * the same swatch is never called two different words (ADR-127).
 */
export function colorWord(hex: string): TranslationKey {
  return `color.${hex.slice(1)}` as TranslationKey;
}

/**
 * The word for a named value: White and Black are `color.<hex>` like every solid value.
 *
 * Transparency has two words by design: a fill says "Transparent" because a shape with no
 * fill still is a shape, while a border or a line says "None" because the role itself is
 * absent (ADR-140). The stored value is the same and is never rewritten.
 */
export function namedColorWord(
  id: NamedColorId,
  role?: NamedColorRole,
): TranslationKey {
  if (id === "none") return role === "fill" ? "color.transparent" : "object.none";
  return `color.${NAMED_COLORS[id].slice(1)}` as TranslationKey;
}

/**
 * The named values the Auto/Dark/White ink control does not already show.
 *
 * White is a segment of that control, so repeating it as a chip would be a second way to
 * say one thing (ADR-140); the model still owns which named values text may take.
 */
export function inkExtraIds(): NamedColorId[] {
  const shownAsSegments: readonly NamedColorId[] = ["white"];
  return colorExtras("text").filter((id) => !shownAsSegments.includes(id));
}

export type InkOption = "auto" | "dark" | "black" | "white" | "own";

export interface ColorNameOptions {
  /** The selection disagrees about this role. */
  mixed?: boolean;
  /** The role whose named values this is; a value outside them is "Custom colour". */
  role?: NamedColorRole;
  /** An absent value means "Auto", which a free text object can be. */
  auto?: boolean;
}

export interface ColorName {
  /** i18n key of the word; the caller translates it. */
  key: TranslationKey;
  /** The hex to show beside "Custom colour"; absent for a named value. */
  detail?: string;
}

/** A stored colour as lower-case `#rrggbb`, `transparent`, or null. */
export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (raw === "transparent") return "transparent";
  const body = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(body)) return null;
  const full =
    body.length === 3
      ? body
          .split("")
          .map((char) => char + char)
          .join("")
      : body;
  return `#${full}`;
}

/**
 * The word for what the role paints now.
 *
 * The palette's twenty-one values are named by hex (`color.<hex>`), and the named values
 * the role offers are named by their chip's word (ADR-140). Anything else is "Custom
 * colour" with its hex beside it, which is how an object from the old palette keeps its
 * look and stops silently claiming a palette entry (ADR-127).
 */
export function colorName(
  value: string | null | undefined,
  options: ColorNameOptions = {},
): ColorName {
  if (options.mixed) return { key: "color.mixed" };
  const hex = normalizeColor(value);
  if (!hex) return options.auto ? { key: "sticky.auto" } : { key: "color.own" };
  const role = options.role;
  const named = role ? colorExtras(role) : [];
  if (hex === "transparent") {
    return named.includes("none")
      ? { key: namedColorWord("none", role) }
      : { key: "color.own", detail: hex };
  }
  if (hex === NAMED_COLORS.black && named.includes("black")) {
    return { key: namedColorWord("black", role) };
  }
  if (hex === NAMED_COLORS.white && named.includes("white")) {
    return { key: namedColorWord("white", role) };
  }
  if (isPaletteColor(hex)) return { key: colorWord(hex) };
  return { key: "color.own", detail: hex };
}

/** Whether a stored value means "nothing painted", so a sample draws a checkerboard. */
export function isTransparent(value: string | null | undefined): boolean {
  return normalizeColor(value) === "transparent";
}

/** Which segment of "Auto / Dark / Black / White" an ink is, or `own` for an old hex. */
export function inkOption(textColor: string | null | undefined): InkOption {
  const hex = normalizeColor(textColor);
  if (!hex) return "auto";
  if (hex === TEXT_INKS.dark) return "dark";
  if (hex === TEXT_INKS.black) return "black";
  if (hex === TEXT_INKS.white) return "white";
  return "own";
}

/**
 * The fill row a tone key keeps.
 *
 * Fills use 100 and 300; a note already painted at 300 stays at 300 when the person
 * changes only the hue, so pressing 4 twice is not a surprise jump to the pale row. A fill
 * outside the palette (an old board) starts at 100 — the row new notes use.
 */
export function fillLevel(value: string | null | undefined): 100 | 300 {
  const match = matchColor(value ?? "");
  return match?.exact && match.color.level === 300 ? 300 : 100;
}

/** The level a role's main colour takes: fills vary, lines and text are always 600. */
export function mainLevel(
  role: "fill" | "line" | "text",
  value: string | null | undefined,
): ColorLevel {
  return role === "fill" ? fillLevel(value) : 600;
}

/**
 * The row a key writes to a whole selection (ADR-129).
 *
 * One row when every fill already sits on it — pressing 4 twice must not jump the
 * selection from the pale row to the deep one. Different rows write 100: the pale row is
 * where new fills start, and a press must not move half the selection down and half up.
 */
export function sharedFillLevel(values: ReadonlyArray<string | null | undefined>): 100 | 300 {
  const levels = new Set(values.map((value) => fillLevel(value)));
  return levels.size === 1 ? [...levels][0]! : 100;
}

/** The hex a tone key writes, or null for an index outside 1–7. */
export function toneColor(toneIndex: number, level: ColorLevel): string | null {
  const tone: ColorTone | undefined = TONES[toneIndex];
  return tone ? TONE_LEVELS[tone][level] : null;
}
