import type { TranslationKey } from "./i18n";

/**
 * The six live reactions (ADR-104 amendment).
 *
 * One list for the board bursts and for the picker in the facilitation menu: an emoji is
 * content the person sends, never an interface icon (ADR-119, Ш6).
 */
export const REACTIONS: ReadonlyArray<{ emoji: string; key: TranslationKey }> = [
  { emoji: "👍", key: "reactions.like" },
  { emoji: "❤️", key: "reactions.love" },
  { emoji: "🔥", key: "reactions.fire" },
  { emoji: "😮", key: "reactions.wow" },
  { emoji: "🎉", key: "reactions.cheer" },
  { emoji: "👏", key: "reactions.clap" },
];
