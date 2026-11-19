/** Joins class names, dropping falsy parts. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Catalogue-only switch that pins a visual state (hover, active…) for review. */
export type Forced = "hover" | "active" | "focus" | "focus-visible";

export const forced = (f: Forced | undefined) => (f ? `is-${f}` : undefined);
