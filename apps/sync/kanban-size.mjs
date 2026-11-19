/**
 * How tall a kanban must be for its cards (ADR-240): the same rule as
 * `kanbanContentHeight` in @remo/model, which this service cannot import (it runs plain
 * `.mjs`). `kanban-size.test.mjs` compares the two on the same inputs, so a change to
 * one without the other fails.
 */

const KANBAN_PADDING = 14;
const KANBAN_CARD_GAP = 10;
const MIN_LANE_HEIGHT = 120;
const CARD_FACE_MIN = 48;
const CARD_FACE_MAX = 140;
const CARD_FACE_DEFAULT = 79;

function cardFaceHeight(stored) {
  const height = stored && stored > 0 ? stored : CARD_FACE_DEFAULT;
  return Math.min(CARD_FACE_MAX, Math.max(CARD_FACE_MIN, height));
}

/**
 * @param {{ swimlanes: Array<{ id: string }>, cards: Record<string, { columnId: string, swimlaneId: string }>, headerHeight: number }} state
 * @param {(cardId: string) => number | undefined} cardHeight
 */
export function kanbanContentHeight(state, cardHeight) {
  const lanes = state.swimlanes.length > 0 ? state.swimlanes : [{ id: "" }];
  let total = state.headerHeight;
  for (const lane of lanes) {
    const cells = new Map();
    for (const [cardId, placement] of Object.entries(state.cards)) {
      if (placement.swimlaneId !== lane.id) continue;
      const list = cells.get(placement.columnId) ?? [];
      list.push(cardFaceHeight(cardHeight(cardId)));
      cells.set(placement.columnId, list);
    }
    let tallest = 0;
    for (const heights of cells.values()) {
      const block = heights.reduce((sum, h) => sum + h, 0) + KANBAN_CARD_GAP * (heights.length - 1);
      tallest = Math.max(tallest, block + KANBAN_PADDING * 2);
    }
    total += Math.max(MIN_LANE_HEIGHT, tallest);
  }
  return total;
}

/**
 * Grow the kanban widget to its content, keeping its top edge, inside the caller's
 * transaction. Never shrinks it.
 */
export function growKanbanToFit(ydoc, kanbanId) {
  const widgets = ydoc.getMap("widgets");
  const widget = widgets.get(kanbanId);
  const kanban = ydoc.getMap("kanbans").get(kanbanId);
  if (!widget || !kanban) return;
  const swimlanes = (kanban.get("swimlanes")?.toArray?.() ?? []).map((lane) => ({ id: String(lane.get("id")) }));
  const cards = {};
  kanban.get("cards")?.forEach?.((placement, cardId) => {
    cards[cardId] = {
      columnId: String(placement.get("columnId")),
      swimlaneId: String(placement.get("swimlaneId")),
    };
  });
  const headerHeight = Number(kanban.get("headerHeight") ?? 96) || 96;
  const need = kanbanContentHeight({ swimlanes, cards, headerHeight }, (id) => widgets.get(id)?.height);
  if (Number(widget.height) >= need - 0.5) return;
  widgets.set(kanbanId, { ...widget, height: need, y: Number(widget.y) + (need - Number(widget.height)) / 2 });
  growFramesAround(ydoc, kanbanId);
}

const FRAME_GROW_MARGIN = 24;

/**
 * The same rule as `frameBoxHolding` in @remo/model (ADR-243): only the sides the child
 * crosses move, to its edge plus the margin; a frame that holds it is returned as is.
 */
export function frameBoxHolding(frame, child, margin = FRAME_GROW_MARGIN) {
  let left = frame.x - frame.width / 2;
  let right = frame.x + frame.width / 2;
  let top = frame.y - frame.height / 2;
  let bottom = frame.y + frame.height / 2;
  const childLeft = child.x - child.width / 2;
  const childRight = child.x + child.width / 2;
  const childTop = child.y - child.height / 2;
  const childBottom = child.y + child.height / 2;
  if (childLeft < left) left = childLeft - margin;
  if (childRight > right) right = childRight + margin;
  if (childTop < top) top = childTop - margin;
  if (childBottom > bottom) bottom = childBottom + margin;
  const width = right - left;
  const height = bottom - top;
  if (width === frame.width && height === frame.height) return frame;
  return { x: left + width / 2, y: top + height / 2, width, height };
}

/** Grow the free, unlocked frames around a member that grew, up the parents (ADR-243). */
export function growFramesAround(ydoc, id) {
  const widgets = ydoc.getMap("widgets");
  let child = widgets.get(id);
  const seen = new Set();
  while (child?.parentId && !seen.has(child.parentId)) {
    seen.add(child.parentId);
    const parent = widgets.get(child.parentId);
    if (!parent || parent.type !== "frame") return;
    if (parent.locked || parent.layout?.kind === "table") return;
    const box = frameBoxHolding(parent, child);
    if (box === parent) return;
    const grown = { ...parent, ...box };
    widgets.set(parent.id, grown);
    child = grown;
  }
}
