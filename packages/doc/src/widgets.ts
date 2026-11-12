import { expandGroups, minimumSizeOf, scalesInBlock, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";
import { connectorsTo } from "./connectors";
import { cardsOf } from "./kanbanState";
import { seedTextField } from "./text";
import { descendants } from "./tree";

/**
 * The life of a widget: create, patch, move, resize, delete.
 *
 * These are the commands every other feature builds on — a frame moves its contents, a
 * kanban loses its cards when deleted, a connector dies with its endpoints. Keeping them
 * in one module is what lets the clipboard and templates reuse them instead of copying
 * the rules (ADR-053).
 */

/* ------------------------------------------------------------ widget ops --- */

export function createWidget(board: BoardDocument, widget: Widget): void {
  board.transact(() => {
    // Stamped once, at creation: the person's name lives in their browser, so the
    // document records who was there at the time rather than asking later (ADR-046).
    const stamped: Widget = {
      ...widget,
      ...(board.author && !widget.createdBy ? { createdBy: board.author } : {}),
      ...(widget.createdAt ? {} : { createdAt: Date.now() }),
    };
    board.widgets.set(widget.id, stamped);
    seedTextField(board, stamped, stamped.title ?? stamped.content ?? "");
  });
}

/**
 * Rename an object (ADR-165).
 *
 * A name is interface metadata, not canvas text: it is trimmed, capped and never
 * painted. An empty value clears it, which is how a person removes a name.
 */
export function setWidgetName(board: BoardDocument, id: string, name: string): void {
  const trimmed = name.trim().slice(0, 120);
  board.transact(() => {
    const current = board.readWidget(id);
    if (!current) return;
    const next = { ...current };
    if (trimmed) next.name = trimmed;
    else delete next.name;
    board.widgets.set(id, next);
  });
}

export function patchWidget(
  board: BoardDocument,
  id: string,
  patch: Partial<Widget>,
): void {
  board.transact(() => {
    const current = board.readWidget(id);
    if (!current) return;
    board.widgets.set(id, { ...current, ...patch });
  });
}

export function deleteWidget(board: BoardDocument, id: string): void {
  board.transact(() => {
    board.widgets.delete(id);
    board.texts.delete(id);
    for (const kanban of board.kanbans.values()) cardsOf(kanban).delete(id);
  });
}

/** Move one widget; `patchWidget` keeps this a single undo step. */
export function moveWidget(board: BoardDocument, id: string, x: number, y: number): void {
  patchWidget(board, id, { x, y });
}

export interface WidgetPosition {
  id: string;
  x: number;
  y: number;
}

/**
 * Move a whole selection by a delta, skipping widgets whose coordinates are owned
 * by a kanban layout.
 */
export function moveSelection(
  board: BoardDocument,
  ids: string[],
  dx: number,
  dy: number,
): void {
  const positions: WidgetPosition[] = [];
  for (const id of ids) {
    const widget = board.readWidget(id);
    if (!widget) continue;
    if (widget.type === "card" && widget.parentId) continue;
    positions.push({ id, x: widget.x + dx, y: widget.y + dy });
  }
  moveWidgets(board, positions);
}

/**
 * Expand a frame to contain the objects that belong to it.
 *
 * A frame is a container, not a group: a child can be dragged outside it. Agent drafts
 * (ADR-189) are written inside their frame, and an older draft can be repaired with this
 * one local action. The frame grows left/up when needed; the children do not move.
 */
export function fitFrameToContents(
  board: BoardDocument,
  frameId: string,
  padding = 32,
): boolean {
  const frame = board.readWidget(frameId);
  if (!frame || frame.type !== "frame" || frame.locked) return false;
  const children = descendants(board, frameId)
    .map((id) => board.readWidget(id))
    .filter((child): child is Widget => Boolean(child) && child?.type !== "card");
  if (!children.length) return false;
  // Widget coordinates are centre-anchored: x/y is the middle of the box.
  const frameLeft = frame.x - frame.width / 2;
  const frameTop = frame.y - frame.height / 2;
  const frameRight = frame.x + frame.width / 2;
  const frameBottom = frame.y + frame.height / 2;
  const childLeft = Math.min(...children.map((child) => child.x - child.width / 2));
  const childTop = Math.min(...children.map((child) => child.y - child.height / 2));
  const childRight = Math.max(...children.map((child) => child.x + child.width / 2));
  const childBottom = Math.max(...children.map((child) => child.y + child.height / 2));
  // Pad only the sides that overflow; an already fitting frame is left alone.
  const left = Math.min(frameLeft, childLeft - padding);
  const top = Math.min(frameTop, childTop - padding);
  const right = Math.max(frameRight, childRight + padding);
  const bottom = Math.max(frameBottom, childBottom + padding);
  const next = {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  };
  if (
    next.x === frame.x &&
    next.y === frame.y &&
    next.width === frame.width &&
    next.height === frame.height
  ) {
    return false;
  }
  board.transact(() => {
    board.widgets.set(frameId, { ...frame, ...next });
  });
  return true;
}

/**
 * Move several widgets to absolute positions in one transaction, so dragging a
 * multi-selection is a single undo step.
 */
export function moveWidgets(board: BoardDocument, positions: WidgetPosition[]): void {
  if (!positions.length) return;
  board.transact(() => {
    const moved = new Set<string>();
    const direct = new Set<string>();

    const apply = (id: string, x: number, y: number) => {
      if (moved.has(id)) return;
      const widget = board.readWidget(id);
      if (!widget) return;
      // Cards inside a kanban are placed by the matrix, never by coordinates.
      if (widget.type === "card" && widget.parentId) return;
      // A locked object may be carried (ADR-210); its size, text and links are still
      // protected by every other command.
      moved.add(id);
      board.widgets.set(id, { ...widget, x, y });

      // Children follow their parent by the same delta.
      for (const childId of descendants(board, id)) {
        const child = board.readWidget(childId);
        if (!child || child.type === "card") continue;
        const dx = x - widget.x;
        const dy = y - widget.y;
        if (moved.has(childId)) continue;
        moved.add(childId);
        board.widgets.set(childId, { ...child, x: child.x + dx, y: child.y + dy });
      }
    };

    for (const position of positions) {
      if (!direct.has(position.id)) {
        direct.add(position.id);
        apply(position.id, position.x, position.y);
      }
    }

    // A frame owns what is dropped inside it and releases what is dragged out.
    // Only the final position matters, and only for the objects the gesture moved
    // directly; descendants followed their parent and keep their membership.
    for (const id of direct) {
      const widget = board.readWidget(id);
      if (!widget) continue;
      if (!ADOPTABLE.has(widget.type)) continue;
      const parent = frameContaining(board, widget);
      const currentParent = widget.parentId ? board.readWidget(widget.parentId) : null;
      if (parent && widget.parentId !== parent.id) {
        board.widgets.set(id, { ...widget, parentId: parent.id });
      } else if (!parent && currentParent?.type === "frame") {
        board.widgets.set(id, { ...widget, parentId: null });
      }
    }
  });
}

const ADOPTABLE = new Set<Widget["type"]>([
  "sticky_note",
  "text",
  "shape",
  "image",
  "stamp",
]);

/** The smallest frame whose box contains the centre of `widget`, if any. */
function frameContaining(board: BoardDocument, widget: Widget): Widget | null {
  // Coordinates are centre-anchored (types.ts): `x`/`y` is the object's centre, so
  // the frame's box is x ± width/2. Reading `x` as a corner put the adoption region
  // half a frame to the right and down of the painted plate (ADR-141).
  const cx = widget.x;
  const cy = widget.y;
  let best: Widget | null = null;
  board.readWidgets().forEach((candidate) => {
    if (candidate.type !== "frame" || candidate.id === widget.id) return;
    if (candidate.locked) return;
    const halfWidth = candidate.width / 2;
    const halfHeight = candidate.height / 2;
    if (
      cx < candidate.x - halfWidth ||
      cx > candidate.x + halfWidth ||
      cy < candidate.y - halfHeight ||
      cy > candidate.y + halfHeight
    ) {
      return;
    }
    if (!best || candidate.width * candidate.height < best.width * best.height) {
      best = candidate;
    }
  });
  return best;
}

/**
 * Re-evaluate membership after a frame's box changed (ADR-141, ADR-110).
 *
 * The centre is the address, exactly as it is on a drop. Children of this frame
 * whose centre left are released — or join the smallest frame that does contain
 * them, so shrinking an inner frame into an outer one has one answer. Free objects
 * whose centre entered are adopted only when this frame is the smallest container.
 * Nothing else is in scope: a child of another frame keeps its parent, and cards,
 * connectors, frames and locked objects are never reparented.
 */
function reconcileFrameMembership(board: BoardDocument, frame: Widget): void {
  const candidates: string[] = [];
  board.readWidgets().forEach((widget) => {
    if (!ADOPTABLE.has(widget.type) || widget.locked) return;
    if (widget.parentId === frame.id || !widget.parentId) candidates.push(widget.id);
  });

  for (const id of candidates) {
    const widget = board.readWidget(id);
    if (!widget) continue;
    const parent = frameContaining(board, widget);
    // A free object joins this frame only if the resize put it in this frame; an
    // object that was already free inside a smaller frame keeps its non-membership
    // until the frame itself changes.
    if (!widget.parentId && parent?.id !== frame.id) continue;
    const next = parent?.id ?? null;
    if (next !== widget.parentId) board.widgets.set(id, { ...widget, parentId: next });
  }
}

/** Absolute-positioning alias used by the UI for nudges and alignment. */
export const setWidgetPositions = moveWidgets;

/** What a delete would remove: the objects and the connectors that die with them. */
export function deletionSummary(
  board: BoardDocument,
  ids: string[],
): { objects: number; connectors: number } {
  const doomed = new Set<string>();
  for (const id of expandGroups(board.readWidgets(), ids)) {
    if (board.readWidget(id)?.locked) continue;
    doomed.add(id);
    for (const childId of descendants(board, id)) doomed.add(childId);
  }
  for (const connectorId of connectorsTo(board, [...doomed])) doomed.add(connectorId);
  let objects = 0;
  let connectors = 0;
  for (const id of doomed) {
    const widget = board.readWidget(id);
    if (!widget) continue;
    if (widget.type === "connector") connectors += 1;
    else objects += 1;
  }
  return { objects, connectors };
}

export interface DeleteWidgetsOptions {
  force?: boolean;
  /** Delete a frame but keep its direct children where they are (ADR-070, ADR-196). */
  keepChildren?: boolean;
}

export function deleteWidgets(
  board: BoardDocument,
  ids: string[],
  options: DeleteWidgetsOptions = {},
): void {
  if (!ids.length) return;
  board.transact(() => {
    const doomed = new Set<string>();
    // Deleting one member of a group deletes the group: half a group is never a
    // state the user asked for.
    for (const id of expandGroups(board.readWidgets(), ids)) {
      const widget = board.readWidget(id);
      // A locked object survives the delete key; unlocking it is the way to remove
      // it, which is the whole point of a lock (ADR-040).
      if (!options.force && widget?.locked) continue;
      doomed.add(id);
      // A section is a container: deleting it keeps its objects on the canvas
      // (ADR-070, ADR-196). Deleting with contents stays a separate choice.
      if (options.keepChildren && widget?.type === "frame") continue;
      for (const childId of descendants(board, id)) doomed.add(childId);
    }

    // Release the children of a kept frame before the frame itself goes: they keep
    // world coordinates, text and links, and lose only the table membership.
    if (options.keepChildren) {
      const frames = [...doomed].filter(
        (id) => board.readWidget(id)?.type === "frame",
      );
      if (frames.length) {
        const kept = new Set(frames);
        for (const child of board.readWidgets()) {
          if (!child.parentId || !kept.has(child.parentId)) continue;
          const { cell: _cell, ...rest } = child;
          board.widgets.set(child.id, { ...rest, parentId: null });
        }
      }
    }

    // Connectors die with their endpoints: a line to nothing is meaningless.
    for (const connectorId of connectorsTo(board, [...doomed])) doomed.add(connectorId);

    const touchedGroups = new Set<string>();
    for (const id of doomed) {
      const groupId = board.readWidget(id)?.groupId;
      if (groupId) touchedGroups.add(groupId);
      board.widgets.delete(id);
      board.texts.delete(id);
      for (const kanban of board.kanbans.values()) cardsOf(kanban).delete(id);
    }
    // A deleted kanban takes its whole matrix with it.
    for (const id of doomed) board.kanbans.delete(id);

    // A name belongs to its membership: when the last member is gone, the label
    // goes with it (ADR-101).
    for (const groupId of touchedGroups) {
      if (!board.readWidgets().some((widget) => widget.groupId === groupId)) {
        board.groupNames.delete(groupId);
      }
    }
  });
}


export interface WidgetRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when one of the widget's ancestors is written directly by the same gesture. */
function carriedByListed(
  board: BoardDocument,
  widget: Widget,
  direct: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>([widget.id]);
  let parentId = widget.parentId;
  while (parentId && !seen.has(parentId)) {
    if (direct.has(parentId)) return true;
    seen.add(parentId);
    parentId = board.readWidget(parentId)?.parentId ?? null;
  }
  return false;
}

/**
 * Move and resize a selection as one block (ADR-211).
 *
 * The boxes come from `scaleBoxes`: centres plus a size computed for a scalable member.
 * This command decides the size itself — a gesture cannot make a locked object smaller by
 * passing a smaller width. A member that cannot scale (locked, imported placeholder, a
 * table section) keeps its size and only travels; a carried container brings its children
 * along, while a resized one leaves them where they are (ADR-141). One transaction, one
 * undo step.
 */
export function transformSelection(board: BoardDocument, boxes: readonly WidgetRect[]): void {
  if (!boxes.length) return;
  board.transact(() => {
    const direct = new Set(boxes.map((box) => box.id));
    const before = new Map<string, Widget>();
    const resized = new Set<string>();
    const resizedFrames = new Set<string>();

    for (const box of boxes) {
      const widget = board.readWidget(box.id);
      if (!widget) continue;
      // Cards inside a kanban are placed by the matrix, never by coordinates.
      if (widget.type === "card" && widget.parentId) continue;
      before.set(widget.id, widget);

      if (scalesInBlock(widget)) {
        const minimum = minimumSizeOf(widget.type);
        board.widgets.set(widget.id, {
          ...widget,
          x: box.x,
          y: box.y,
          width: Math.max(minimum.width, box.width),
          height: Math.max(minimum.height, box.height),
        });
        resized.add(widget.id);
        if (widget.type === "frame") resizedFrames.add(widget.id);
      } else {
        board.widgets.set(widget.id, { ...widget, x: box.x, y: box.y });
      }
    }

    for (const [id, widget] of before) {
      if (resized.has(id)) continue;
      // A child that the gesture writes itself has its own target; shifting it again
      // as a descendant would move it twice.
      if (carriedByListed(board, widget, direct)) continue;
      const current = board.readWidget(id);
      if (!current) continue;
      const dx = current.x - widget.x;
      const dy = current.y - widget.y;
      if (dx === 0 && dy === 0) continue;
      for (const childId of descendants(board, id)) {
        if (direct.has(childId)) continue;
        const child = board.readWidget(childId);
        if (!child || child.type === "card") continue;
        board.widgets.set(childId, { ...child, x: child.x + dx, y: child.y + dy });
      }
    }

    for (const id of resizedFrames) {
      const frame = board.readWidget(id);
      if (frame) reconcileFrameMembership(board, frame);
    }
  });
}

/**
 * Resize and place several widgets in one transaction (a resize gesture).
 *
 * A frame's contents keep their size and position: resizing the container never
 * scales or moves its children (ADR-141). What does change is membership — the
 * centre rule of ADR-110 is evaluated again inside the same transaction, so the
 * resize and the parent changes are one undo step.
 */
export function setWidgetRects(board: BoardDocument, rects: WidgetRect[]): void {
  if (!rects.length) return;
  board.transact(() => {
    const resizedFrames = new Set<string>();
    for (const rect of rects) {
      const widget = board.readWidget(rect.id);
      if (!widget || widget.locked) continue;
      const minimum = minimumSizeOf(widget.type);
      board.widgets.set(rect.id, {
        ...widget,
        x: rect.x,
        y: rect.y,
        width: Math.max(minimum.width, rect.width),
        height: Math.max(minimum.height, rect.height),
      });
      if (widget.type === "frame") resizedFrames.add(rect.id);
    }
    for (const id of resizedFrames) {
      const frame = board.readWidget(id);
      if (frame) reconcileFrameMembership(board, frame);
    }
  });
}

