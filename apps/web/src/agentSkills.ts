/**
 * Which skills the selector may offer for the current source.
 *
 * A skill that cannot run with what the person has is not shown, because a selector
 * that offers an impossible choice turns a refusal into a discovery (ADR-143). "Auto"
 * is always there: the server resolves it from the intent and the selection.
 */

export interface SelectableSkill {
  id: string;
  slug: string;
  name: string;
}

/** Skills that need a selection to act on. */
const NEEDS_SELECTION = new Set(["cards", "tidy-selection"]);

export function compatibleSkills<T extends SelectableSkill>(
  skills: readonly T[],
  { hasSelection }: { hasSelection: boolean },
): T[] {
  return skills.filter((skill) => !NEEDS_SELECTION.has(skill.slug) || hasSelection);
}

/** The value of the "Auto" option; the server treats an empty slug as a hint search. */
export const AUTO_SKILL = "";
