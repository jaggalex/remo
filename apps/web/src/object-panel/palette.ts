import {
  FILL_LEVELS,
  NAMED_COLORS,
  colorAt,
  colorExtras,
  colorsForLevels,
  type NamedColorId,
  type ToneColor,
} from "@remo/model";
import type { TranslationKey } from "../i18n";
import { colorWord, namedColorWord } from "./colorWindowData";

/**
 * The rail's quick colour choice (ADR-123/DS §4, ADR-127).
 *
 * It is not a second palette: the rail draws the same fill grid as the colour window —
 * seven tonal columns × the 100 and 300 rows — through the same model function
 * (`colorsForLevels(FILL_LEVELS)`) and names every swatch with the same `color.<hex>`
 * key. A note's default is the yellow 100 entry itself, so the marked swatch is exactly
 * what a click on the sticky tool paints.
 *
 * The document stores a hex, so the model carries values rather than token names; the
 * values are the design system's primitives, checked against `tokens.json` by
 * `colorLevels.test.ts`. The twenty-two `BOARD_COLORS` are not offered as grid entries: an
 * object that carries one keeps its hex and the window names it "Custom colour" (ADR-127).
 * `#1a1a1a` is the one exception in name only — it is the black chip of ADR-140, so a role
 * that offers Black calls it that; no value is rewritten.
 */

export interface NoteFillChoice extends ToneColor {
  /** i18n key of the colour name, the same one the window's swatch uses. */
  key: TranslationKey;
}

/**
 * The fourteen fills a note offers, in the window's order: the whole 100 row, then 300.
 *
 * Seven columns × two rows. The rail's flyout lays them out in this exact sequence, so a
 * person who learned the grid in one place reads the other without re-learning it.
 */
export function noteFillChoices(): NoteFillChoice[] {
  return colorsForLevels(FILL_LEVELS).map((color) => ({
    ...color,
    key: colorWord(color.hex),
  }));
}

/** A named chip of the rail's flyout. */
export interface NamedFillChoice {
  id: NamedColorId;
  /** The value a created note stores. */
  value: string;
  /** i18n key of the word, the same one the window's chip uses. */
  key: TranslationKey;
}

/**
 * The named values a note offers beside the grid, in the model's order (ADR-140).
 *
 * White and Black are chips, not rows: they never enter the fourteen swatches and take no
 * key 1–7. The rail reads the same list as the note's colour window, so the two surfaces
 * cannot offer a different order.
 */
export function noteFillExtras(): NamedFillChoice[] {
  return colorExtras("note").map((id) => ({
    id,
    value: NAMED_COLORS[id],
    key: namedColorWord(id, "note"),
  }));
}

/** What a note created with no colour chosen gets: yellow at the fill's pale row. */
export function defaultStickerFill(): string {
  return colorAt("yellow", 100).hex;
}
