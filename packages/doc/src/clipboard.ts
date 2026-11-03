import * as Y from "yjs";
import {
  bounds,
  expandGroups,
  joinsWithin,
  newId,
  orderBetween,
  type KanbanPlacement,
  type KanbanState,
  type TextDeltaOp,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { cardsOf, cellOrders, readKanban, writeKanbanState } from "./kanbanState";
import { seedTextField } from "./text";
import { descendants } from "./tree";

/**
 * The clipboard: a fragment of a board, and pasting it back.
 *
 * A fragment is plain JSON with its own ids and a version, so it travels between tabs,
 * boards and machines; pasting remaps every id, parent, endpoint and group, in one undo
 * step. Keeping it out of the document class also keeps the class from knowing about the
 * system clipboard (ADR-053).
 */

/* ------------------------------------------------------------ clipboard --- */

/** One widget's text, formatted or not. */
export interface FragmentText {
  delta: TextDeltaOp[];
}

/**
 * A board fragment on the clipboard.
 *
 * Ids are source ids; paste remaps every one of them, so the same payload works in
 * another room without collisions. `roots` is what the user had selected, which is
 * what should be selected again after the paste.
 */
export interface BoardFragment {
  version: 1;
  widgets: Widget[];
  texts: Record<string, FragmentText>;
  kanbans: Record<string, KanbanState>;
  /** Placements for cards, including cards copied without their kanban. */
  placements: Record<string, KanbanPlacement>;
  /** Names of the groups in the fragment, keyed by the source group id (ADR-101). */
  groupNames?: Record<string, string>;
  roots: string[];
}

/**
 * Capture a selection, with everything it owns.
 *
 * A frame takes its contents, a kanban takes its cards and matrix, and a connector
 * comes along only when both of its ends do — a line to an object that was not
 * copied has nothing to join.
 */
export function copyFragment(board: BoardDocument, ids: string[]): BoardFragment | null {
  const all = [...board.widgets.values()];
  const roots = expandGroups(all, ids).filter((id) => board.widgets.has(id));
  if (!roots.length) return null;

  const included = new Set(roots);
  for (const id of roots) {
    for (const childId of descendants(board, id)) included.add(childId);
  }
  for (const widget of all) {
    if (widget.type !== "connector") continue;
    if (joinsWithin(widget, included)) included.add(widget.id);
  }

  const widgets = all.filter((widget) => included.has(widget.id));
  const texts: Record<string, FragmentText> = {};
  const kanbans: Record<string, KanbanState> = {};
  const placements: Record<string, KanbanPlacement> = {};
  const groupNames: Record<string, string> = {};
  for (const widget of widgets) {
    if (!widget.groupId) continue;
    const name = board.groupNames.get(widget.groupId);
    if (name) groupNames[widget.groupId] = name;
  }

  for (const widget of widgets) {
    const delta = board.deltaOf(widget.id);
    if (delta.length) texts[widget.id] = { delta };

    if (widget.type === "kanban") {
      const state = board.kanbans.get(widget.id);
      if (state) kanbans[widget.id] = readKanban(state);
    }
    if (widget.type === "card" && widget.parentId) {
      const state = board.kanbans.get(widget.parentId);
      const placement = state ? readKanban(state).cards[widget.id] : undefined;
      if (placement) placements[widget.id] = placement;
    }
  }

  return { version: 1, widgets, texts, kanbans, placements, groupNames, roots };
}

export interface PasteOptions {
  /** World-space shift; defaults to a small cascade. */
  offset?: { x: number; y: number };
  /** Put the fragment's top-left corner here instead (right-click paste). */
  at?: { x: number; y: number };
}

/**
 * Paste a fragment into this board as one undo step.
 *
 * Every id is remapped, parent links and connector endpoints are remapped with it,
 * group ids become one new group, and a copied kanban brings a fresh matrix with
 * remapped card ids. A card copied on its own is appended to the end of its cell;
 * if that kanban or cell is gone, the card is dropped rather than left floating.
 */
export function pasteFragment(
  board: BoardDocument,
  fragment: BoardFragment,
  options: PasteOptions = {},
): string[] {
  if (!fragment || fragment.version !== 1 || !fragment.widgets.length) return [];

  const idMap = new Map<string, string>();
  for (const widget of fragment.widgets) {
    idMap.set(widget.id, newId(`${widget.type.slice(0, 4)}_paste`));
  }
  const groupMap = new Map<string, string>();
  for (const widget of fragment.widgets) {
    if (widget.groupId && !groupMap.has(widget.groupId)) {
      groupMap.set(widget.groupId, newId("grp"));
    }
  }

  // Cards live in a matrix and have no meaningful coordinates, so they must not
  // influence where the rest of the fragment lands.
  const spatial = fragment.widgets.filter(
    (widget) => widget.type !== "card" && widget.type !== "connector",
  );
  const box = bounds(spatial);
  const offset = options.at
    ? { x: options.at.x - box.x, y: options.at.y - box.y }
    : (options.offset ?? { x: 24, y: 24 });

  const inserted = new Set<string>();
  const roots: string[] = [];
  const cards: Array<{
    source: Widget;
    id: string;
    parentId: string;
    placement: KanbanPlacement;
  }> = [];

  board.transact(() => {
    for (const widget of fragment.widgets) {
      const id = idMap.get(widget.id)!;
      const parentId = widget.parentId
        ? (idMap.get(widget.parentId) ??
          (board.widgets.has(widget.parentId) ? widget.parentId : null))
        : null;

      if (widget.type === "card") {
        const placement = fragment.placements[widget.id];
        if (!placement || !parentId) continue;
        cards.push({ source: widget, id, parentId, placement });
      }

      let start: { item: string } | undefined;
      let end: { item: string } | undefined;
      if (widget.type === "connector") {
        const from = widget.start?.item ? idMap.get(widget.start.item) : undefined;
        const to = widget.end?.item ? idMap.get(widget.end.item) : undefined;
        if (!from || !to) continue;
        start = { item: from };
        end = { item: to };
      }

      const groupId = widget.groupId ? groupMap.get(widget.groupId) : undefined;
      const next: Widget = {
        ...widget,
        id,
        parentId,
        x: widget.type === "card" ? widget.x : widget.x + offset.x,
        y: widget.type === "card" ? widget.y : widget.y + offset.y,
        ...(widget.type === "connector" ? { start, end } : {}),
      };
      if (groupId) next.groupId = groupId;
      else delete next.groupId;
      // A copy is a new decision, not a second copy of somebody's lock (ADR-107).
      delete next.locked;
      delete next.lockedBy;
      delete next.lockedByName;
      delete next.lockedAt;

      board.widgets.set(id, next);
      const text = fragment.texts[widget.id];
      if (text) seedFragmentText(board, id, text.delta);
      else seedTextField(board, next, next.title ?? next.content ?? "");
      inserted.add(id);
    }

    // A copied group keeps its label under the new id; the copy is still a new
    // cluster, not a second name for the source.
    for (const [oldId, name] of Object.entries(fragment.groupNames ?? {})) {
      const groupId = groupMap.get(oldId);
      if (groupId) board.groupNames.set(groupId, name);
    }

    // A copied kanban brings its columns, swimlanes and card placement.
    for (const [oldId, state] of Object.entries(fragment.kanbans)) {
      const kanbanId = idMap.get(oldId);
      if (!kanbanId || !inserted.has(kanbanId)) continue;
      writeKanbanState(board, kanbanId, state, idMap);
    }

    // A card copied on its own goes to the end of the same cell. Cards that came
    // with their kanban were already placed by the matrix above.
    for (const { source, id, parentId, placement } of cards) {
      if (!inserted.has(id)) continue;
      if (source.parentId && fragment.kanbans[source.parentId]) continue;

      const kanban = board.kanbans.get(parentId);
      const state = kanban ? readKanban(kanban) : null;
      const column = state?.columns.find((entry) => entry.id === placement.columnId);
      const lane = state?.swimlanes.find((entry) => entry.id === placement.swimlaneId);
      if (!kanban || !state || !column || !lane) {
        board.widgets.delete(id);
        board.texts.delete(id);
        inserted.delete(id);
        continue;
      }

      const cell = cellOrders(kanban, placement.columnId, placement.swimlaneId);
      const entry = new Y.Map<unknown>();
      entry.set("columnId", placement.columnId);
      entry.set("swimlaneId", placement.swimlaneId);
      entry.set("order", orderBetween(cell[cell.length - 1]?.order));
      cardsOf(kanban).set(id, entry);
    }

    // Never leave a card that the matrix did not accept.
    for (const id of [...inserted]) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "card") continue;
      const kanban = widget.parentId ? board.kanbans.get(widget.parentId) : undefined;
      if (!kanban || !cardsOf(kanban).has(id)) {
        board.widgets.delete(id);
        board.texts.delete(id);
        inserted.delete(id);
      }
    }

    for (const root of fragment.roots) {
      const mapped = idMap.get(root);
      if (mapped && inserted.has(mapped)) roots.push(mapped);
    }
  });

  return roots;
}

/** Write a clipboard text value: rich if any operation carries marks. */
function seedFragmentText(board: BoardDocument, id: string, delta: TextDeltaOp[]): void {
  if (delta.some((op) => op.attributes && Object.keys(op.attributes).length)) {
    const text = new Y.XmlText();
    let index = 0;
    for (const op of delta) {
      if (!op.insert) continue;
      text.insert(index, op.insert, op.attributes);
      index += op.insert.length;
    }
    board.texts.set(id, text);
    return;
  }

  const text = new Y.Text();
  const plain = delta.map((op) => op.insert).join("");
  if (plain) text.insert(0, plain);
  board.texts.set(id, text);
}

