import { kindOf, layerKey, paintOrder, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Lock and stacking order.
 *
 * Both are decisions about the whole board rather than about one object, and both were
 * the source of subtle bugs when they lived next to the commands that happened to use
 * them: a locked object that could still be restyled, a connector whose layer nobody
 * could change (ADR-039, ADR-040).
 */

/* ---------------------------------------------------------------- locking --- */

/** Who is taking or releasing the lock; absent keeps a legacy, authorless lock. */
export interface LockActor {
  id: string;
  name: string;
}

/**
 * Lock or unlock the selection.
 *
 * A locked object cannot be moved, resized, edited or deleted, but it can still be
 * selected and unlocked. The lock records its author (ADR-107); releasing it clears the
 * author too, so the next lock belongs to whoever takes it. One transaction, one undo
 * step (ADR-040).
 *
 * The permission check lives in the caller (`canUnlock`): this function is the document
 * write, and a raw document client can still bypass it.
 */
export function setLocked(
  board: BoardDocument,
  ids: readonly string[],
  locked: boolean,
  actor?: LockActor | null,
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget) continue;
      // Locking an already locked object must not take authorship from its author.
      if (locked && widget.locked) continue;
      const next = { ...widget };
      if (locked) {
        next.locked = true;
        if (actor) {
          next.lockedBy = actor.id;
          next.lockedByName = actor.name;
        }
        next.lockedAt = Date.now();
      } else {
        delete next.locked;
        delete next.lockedBy;
        delete next.lockedByName;
        delete next.lockedAt;
      }
      board.widgets.set(id, next);
    }
  });
}

/* ---------------------------------------------------------------- layering --- */

/** Where a layer command sends the selection. */
export type LayerMove = "front" | "forward" | "backward" | "back";

/**
 * Move the selection in the stacking order.
 *
 * The order is a document property now, not a side effect of a widget's type: the
 * command rewrites `z` on the objects that need it, leaving the rest on their type's
 * base layer (ADR-039).
 *
 * - `front` and `back` move the whole selection as a block, keeping its inner order.
 * - `forward` and `backward` shift it one slot, passing exactly one neighbour.
 * - Cards keep out of this: their place in the matrix is not a layer.
 */
export function reorderWidgets(
  board: BoardDocument,
  ids: readonly string[],
  move: LayerMove,
): void {
  const selected = new Set(ids);
  const list = paintOrder(
    [...board.widgets.values()].filter((widget) => kindOf(widget.type).layered),
  );
  if (!list.some((widget) => selected.has(widget.id))) return;

  const moving = list.filter((widget) => selected.has(widget.id));
  const rest = list.filter((widget) => !selected.has(widget.id));
  let ordered: Widget[];

  switch (move) {
    case "front":
      ordered = [...rest, ...moving];
      break;
    case "back":
      ordered = [...moving, ...rest];
      break;
    case "forward": {
      ordered = [...list];
      // Walk from the top so two selected neighbours keep their relative order and
      // never step past each other.
      for (let i = ordered.length - 2; i >= 0; i -= 1) {
        const here = ordered[i]!;
        const above = ordered[i + 1]!;
        if (selected.has(here.id) && !selected.has(above.id)) {
          ordered[i] = above;
          ordered[i + 1] = here;
        }
      }
      break;
    }
    default: {
      ordered = [...list];
      for (let i = 1; i < ordered.length; i += 1) {
        const here = ordered[i]!;
        const below = ordered[i - 1]!;
        if (selected.has(here.id) && !selected.has(below.id)) {
          ordered[i] = below;
          ordered[i - 1] = here;
        }
      }
      break;
    }
  }

  board.transact(() => {
    // Only the objects whose key would not keep the new order are rewritten. The
    // first reorder of a type usually nudges its siblings once; after that, keys are
    // already distinct.
    let previous = Number.NEGATIVE_INFINITY;
    for (const widget of ordered) {
      const key = layerKey(widget);
      const next = key <= previous ? previous + 1 : key;
      previous = next;
      if (next !== key) {
        const live = board.widgets.get(widget.id);
        if (live) board.widgets.set(widget.id, { ...live, z: next });
      }
    }
  });
}

