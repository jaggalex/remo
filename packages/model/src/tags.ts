/**
 * Board tags (ADR-102).
 *
 * A tag is a board-level record with a stable id; a widget carries ids, never the tag's
 * text. Renaming is therefore one write, and a second object cannot keep an old copy.
 */
export type TagColor = "blue" | "green" | "yellow" | "red" | "gray";

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

export const TAG_COLORS: readonly TagColor[] = ["blue", "green", "yellow", "red", "gray"];

export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  blue: "tag.blue",
  green: "tag.green",
  yellow: "tag.yellow",
  red: "tag.red",
  gray: "tag.gray",
};

export const MAX_TAGS_PER_BOARD = 50;
export const MAX_TAGS_PER_OBJECT = 10;

export function isTagColor(value: string): value is TagColor {
  return (TAG_COLORS as readonly string[]).includes(value);
}
