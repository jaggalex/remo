import { bounds, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Gathering a selection into a section (ADR-198).
 *
 * The frame is a box around what is already there; the objects keep their ids, text,
 * links and world positions, and only their `parentId` changes. Frame and membership are
 * one transaction, so one undo puts everything back. Conflicts are reported, not hidden:
 * the caller decides whether to gather the rest, take an object out of another section,
 * or cancel.
 */

/** The padding between the outermost object and the section's edge, in world units. */
export const GATHER_PADDING = 32;

/** Objects that can be members of a section. Connectors, cards and frames cannot. */
export const GATHERABLE_TYPES: ReadonlySet<Widget["type"]> = new Set([
  "sticky_note",
  "text",
  "shape",
  "image",
  "stamp",
]);
const GATHERABLE = GATHERABLE_TYPES;

export type GatherConflictKind = "locked" | "nested" | "otherSection";

export interface GatherConflict {
  kind: GatherConflictKind;
  id: string;
  /** The section the object currently belongs to, for `otherSection`. */
  sectionId?: string;
}

export interface GatherOptions {
  /** The frame id the caller reserved, so the command and its preview agree. */
  id: string;
  title: string;
  padding?: number;
  /**
   * Take objects out of another section and gather them here. Without it those objects
   * are skipped and reported, which is the safe default.
   */
  takeOut?: boolean;
}

export interface GatherResult {
  frameId: string | null;
  gathered: string[];
  skipped: string[];
  conflicts: GatherConflict[];
}

/**
 * Create one section around two or more ordinary selected objects.
 *
 * The command does not ask a question: it applies the caller's decision. A locked object
 * is never moved; an object in another section is skipped unless `takeOut` is true; a
 * frame in the selection is reported as `nested` and never becomes a member.
 */
export interface GatherPlan {
  members: Widget[];
  objects: Widget[];
  conflicts: GatherConflict[];
  /** The future section box (corner + size), or null when fewer than two can join. */
  box: { x: number; y: number; width: number; height: number } | null;
}

/**
 * What a gather would do, without doing it: the members, the conflicts and the section
 * box. The command and the preview read this one function, so the dashed outline shown
 * before the click is the box the click creates (ADR-198, ADR-201).
 */
export function gatherPlan(
  widgets: readonly Widget[],
  ids: readonly string[],
  options: { id?: string; padding?: number; takeOut?: boolean } = {},
): GatherPlan {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const selected = ids
    .map((id) => byId.get(id))
    .filter((widget): widget is Widget => Boolean(widget));

  const conflicts: GatherConflict[] = [];
  for (const widget of selected) {
    if (widget.type === "frame") {
      conflicts.push({ kind: "nested", id: widget.id });
      continue;
    }
    if (!GATHERABLE.has(widget.type)) continue;
    if (widget.locked) {
      conflicts.push({ kind: "locked", id: widget.id });
      continue;
    }
    if (widget.parentId) {
      const parent = byId.get(widget.parentId);
      if (parent?.type === "frame" && parent.id !== options.id) {
        conflicts.push({ kind: "otherSection", id: widget.id, sectionId: parent.id });
      }
    }
  }

  const locked = new Set(
    conflicts.filter((conflict) => conflict.kind === "locked").map((conflict) => conflict.id),
  );
  const elsewhere = new Set(
    conflicts
      .filter((conflict) => conflict.kind === "otherSection")
      .map((conflict) => conflict.id),
  );
  const objects = selected.filter((widget) => GATHERABLE.has(widget.type));
  const members = objects.filter(
    (widget) =>
      !locked.has(widget.id) && (options.takeOut === true || !elsewhere.has(widget.id)),
  );
  if (members.length < 2) return { members, objects, conflicts, box: null };
  const box = bounds(members);
  const padding = options.padding ?? GATHER_PADDING;
  return {
    members,
    objects,
    conflicts,
    box: {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    },
  };
}

export function gatherIntoSection(
  board: BoardDocument,
  ids: readonly string[],
  options: GatherOptions,
): GatherResult {
  const { members, objects, conflicts, box } = gatherPlan(board.readWidgets(), ids, options);

  if (!box) {
    return {
      frameId: null,
      gathered: [],
      skipped: objects.map((widget) => widget.id),
      conflicts,
    };
  }

  const frame: Widget = {
    id: options.id,
    type: "frame",
    parentId: null,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width: box.width,
    height: box.height,
    title: options.title,
  };

  let frameId: string | null = null;
  board.transact(() => {
    board.widgets.set(frame.id, frame);
    for (const widget of members) {
      const current = board.readWidget(widget.id);
      if (!current) continue;
      board.widgets.set(widget.id, { ...current, parentId: frame.id });
    }
    frameId = frame.id;
  });

  const gathered = new Set(members.map((widget) => widget.id));
  return {
    frameId,
    gathered: [...gathered],
    skipped: objects.filter((widget) => !gathered.has(widget.id)).map((widget) => widget.id),
    conflicts,
  };
}
