import type { WidgetType } from "./types";

/**
 * What a kind of object can do (ADR-049).
 *
 * These answers used to live in five places at once: `canConnect` in the model,
 * `holdsText` in the document, `isEditable` in the app, the paint ranks in a table,
 * and a handful of `type === "…"` checks in the arrange and layer commands. Adding a
 * capability then meant finding every copy — and the copies had already started to
 * disagree. One table, consulted by everybody, is the smallest honest fix: it changes
 * no behaviour, but it turns "add a widget type" from eight files into this file.
 *
 * A capability is added here only when at least two modules need to agree on it.
 */
export interface KindSpec {
  /** Paint layer when the object carries no explicit `z`; higher is on top. */
  rank: number;
  /** Holds text: a note's body, a card's title, a line's label. */
  text: boolean;
  /** Can be an endpoint of a connector, so it shows anchors. */
  connectable: boolean;
  /** Opens in the inline text editor (double-click, Enter, Tab from a note). */
  editable: boolean;
  /** Takes part in the stacking order. Cards do not: the matrix places them. */
  layered: boolean;
  /** Has a free position, so align/distribute may move it. */
  movable: boolean;
  /** Can be a member of a group (ADR-022). */
  groupable: boolean;
  /** Gets corner handles when it is selected alone. */
  resizable: boolean;
  /**
   * Smallest box a corner handle may leave (ADR-141).
   *
   * Absent means the generic floor below, which is enough for a handle and a word.
   * A frame needs its own floor: below it there is no title band and no room to
   * drop anything inside.
   */
  minSize?: { width: number; height: number };
}

/** Generic floor for a kind whose box is still meaningful while small. */
export const DEFAULT_MIN_SIZE = { width: 80, height: 60 };

/**
 * The floor a resize of `type` must respect.
 *
 * One function, so the gesture (which clamps the preview), the document command
 * (which clamps what is written) and any future caller cannot disagree.
 */
export function minimumSizeOf(type: WidgetType | string): { width: number; height: number } {
  return kindOf(type).minSize ?? DEFAULT_MIN_SIZE;
}

/**
 * Capabilities per kind.
 *
 * `Record<WidgetType, …>` rather than a lookup with a fallback: a new member of
 * `WidgetType` must be given an answer here or the build fails, which is exactly the
 * reminder we want. The fallback below only serves data from the wire.
 */
export const WIDGET_KINDS: Record<WidgetType, KindSpec> = {
  frame: {
    // Frames sit at the back: their contents must never be covered by their plate.
    rank: 0,
    text: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    // A frame is a layout container, not a fixed picture: the person who made it
    // decides how much of the board it covers (ADR-141).
    resizable: true,
    // Title band 18 px plus 16 px of padding on each side leaves 70 px of usable
    // height at 120; 160 is the narrowest box that still shows the frame's name
    // and lets a note's centre land inside. Below that a frame is a line (ADR-141).
    minSize: { width: 160, height: 120 },
  },
  kanban: {
    rank: 1,
    text: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  shape: {
    rank: 2,
    text: true,
    connectable: true,
    editable: true,
    layered: true,
    movable: true,
    groupable: true,
    // A shape is a note with another outline: it holds text, has a box and takes
    // the same four corner handles. The preset size is a starting point, not a
    // property of the kind (ADR-145).
    resizable: true,
  },
  image: {
    rank: 2,
    text: false,
    connectable: true,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  unsupported: {
    rank: 2,
    text: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  connector: {
    // A line sits above the objects it joins; its label is painted on top of it.
    rank: 3,
    text: true,
    // No anchor on a line: a connector between connectors is not a diagram.
    connectable: false,
    editable: true,
    layered: true,
    // A line has no position of its own — it is derived from its endpoints.
    movable: false,
    groupable: false,
    resizable: false,
  },
  /**
   * A legacy group object from imported boards.
   *
   * This clone models a group as membership (`groupId`), not as a container
   * (ADR-022), so nothing creates these — but an imported board can still contain one,
   * and it must keep behaving like the plain box it was.
   */
  group: {
    rank: 5,
    text: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  timer: {
    // Above notes and cards: a countdown nobody can see is not a shared timer.
    rank: 7,
    // The painter draws the countdown itself: the object has no editable text and is
    // configured from its own controls, not by typing into it (ADR-075).
    text: false,
    connectable: false,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: true,
  },
  stamp: {
    rank: 4,
    text: false,
    connectable: true,
    editable: false,
    layered: true,
    movable: true,
    groupable: true,
    resizable: false,
  },
  sticky_note: {
    rank: 5,
    text: true,
    connectable: true,
    editable: true,
    layered: true,
    movable: true,
    groupable: true,
    resizable: true,
  },
  card: {
    rank: 6,
    // A card's text is its title, typed in place.
    text: true,
    // A card can be an endpoint; geometry resolves its box through the kanban
    // placement (ADR-113).
    connectable: true,
    editable: true,
    // A card's layer is its cell, not a z index.
    layered: false,
    movable: false,
    groupable: false,
    resizable: false,
  },
  text: {
    // Text blocks sit above everything: a caption is never covered.
    rank: 9,
    text: true,
    connectable: true,
    editable: true,
    layered: true,
    movable: true,
    groupable: true,
    resizable: true,
  },
};

/**
 * Conservative answer for a type this build does not know.
 *
 * An unknown widget is shown and can be moved and selected, but it accepts no text,
 * no connectors and no editing: guessing "yes" would offer actions that fail.
 */
const UNKNOWN_KIND: KindSpec = {
  rank: 5,
  text: false,
  connectable: false,
  editable: false,
  layered: true,
  movable: true,
  groupable: true,
  resizable: false,
};

export function kindOf(type: WidgetType | string): KindSpec {
  return (WIDGET_KINDS as Record<string, KindSpec | undefined>)[type] ?? UNKNOWN_KIND;
}
