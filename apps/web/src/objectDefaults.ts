/**
 * The values an object paints with before anyone chooses one (ADR-129, ADR-134).
 *
 * These were written inline in ten components — `?? "#ffffff"` for a fill, `?? "#1a1a1a"`
 * for ink — so the same three defaults existed twenty times and a colour literal could not
 * be told apart from data. They live here now: one place to read the default, one place to
 * change it, and `scripts/ui-rules-check.mjs` can fail any other file that writes a literal.
 *
 * These are paint values, not tokens: they describe what a *document* holds, and a document
 * is portable, so it cannot reference a theme token. The theme decides how a stored colour
 * looks, not what is stored (ADR-038, ADR-129).
 */

/** A new shape or note is a white sheet until someone paints it. */
export const DEFAULT_FILL = "#ffffff";

/** Ink, and the border a shape gets today. */
export const DEFAULT_INK = "#1a1a1a";

/** The stroke a new line takes in the colour window (grey 600, ADR-127). */
export const DEFAULT_LINE_STROKE = "#595959";

/** A secondary text colour, used where the ink would be too loud. */
export const DEFAULT_MUTED_INK = "#4b5563";

/**
 * A translucent sheet over the canvas, so the board stays visible behind a floating
 * editor. Two values exist today for the same idea — 0.94 under the inline text editor,
 * 0.96 under the connector bar — and they are kept apart on purpose in this change:
 * unifying them is a visual decision for the owner, not a cleanup (ADR-134).
 */
export const DEFAULT_EDITOR_SURFACE = "rgba(255, 255, 255, 0.94)";
export const DEFAULT_BAR_SURFACE = "rgba(255, 255, 255, 0.96)";
