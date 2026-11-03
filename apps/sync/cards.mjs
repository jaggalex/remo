/**
 * The `cards` skill: selected notes become cards, optionally in a kanban column.
 *
 * This is a deterministic domain operation, not a model call. It reads the source text
 * from the shared document (never from the request body), validates the whole batch
 * before writing, and applies it in one transaction up to a fixed limit. Larger batches
 * are a change set, not a loop inside one transaction
 * (spec/skills/cards.md).
 */
import { Y } from "./y.mjs";

export const CARD_LIMITS = { maxPerTask: 500, chunk: 50, title: 120, text: 10_000 };
const CARD_WIDTH = 422.08;
const CARD_HEIGHT = 79.14;
const GAP_X = 24;
const GAP_Y = 16;
const COLUMNS = 3;
const TEXT_TYPES = new Set(["sticky_note", "text", "shape"]);

export class CardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CardError";
    this.code = code;
  }
}

export function makeId(prefix) {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${random}`;
}

/** Fractional order key, the same rule as `orderBetween` in @remo/model. */
export function orderBetween(before, after) {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  const low = before ?? "";
  const high = after ?? "";
  if (!low && !high) return "n";
  let prefix = "";
  for (let index = 0; ; index += 1) {
    const lower = index < low.length ? low[index] : digits[0];
    const upper = index < high.length ? high[index] : digits[digits.length - 1];
    const a = digits.indexOf(lower);
    const b = digits.indexOf(upper);
    if (b - a > 1) return prefix + digits[Math.floor((a + b) / 2)];
    prefix += lower;
    if (index > 64) return `${prefix}n`;
  }
}

function readText(ydoc, id) {
  const widget = ydoc.getMap("widgets").get(String(id));
  if (!widget) return null;
  if (!TEXT_TYPES.has(widget.type)) return { widget, text: "", reason: "not_text" };
  const shared = ydoc.getMap("texts").get(String(id));
  const text = String(shared?.toString() ?? widget.title ?? widget.content ?? "").trim();
  return { widget, text };
}

function splitTitle(text) {
  const lines = text.split(/\r?\n/);
  const first = (lines[0] ?? "").trim().slice(0, CARD_LIMITS.title);
  const rest = lines.slice(1).join("\n").trim();
  return { title: first || text.slice(0, CARD_LIMITS.title), content: rest };
}

function readKanban(ydoc, target) {
  const widgets = ydoc.getMap("widgets");
  const kanbans = ydoc.getMap("kanbans");
  const requested = target?.kanbanId ? String(target.kanbanId) : null;
  const kanbanId =
    requested ??
    [...widgets.values()].find((widget) => widget.type === "kanban")?.id ??
    null;
  if (!kanbanId) throw new CardError("TARGET_NOT_FOUND", "this board has no kanban");
  const kanban = kanbans.get(kanbanId);
  if (!kanban) throw new CardError("TARGET_NOT_FOUND", "this board has no kanban");

  const columns = (kanban.get("columns")?.toArray?.() ?? []).map((column) => ({
    id: String(column.get("id")),
    title: String(column.get("title") ?? ""),
  }));
  const swimlanes = (kanban.get("swimlanes")?.toArray?.() ?? []).map((lane) => ({
    id: String(lane.get("id")),
    title: String(lane.get("title") ?? ""),
  }));
  if (!columns.length) throw new CardError("TARGET_NOT_FOUND", "the kanban has no columns");
  const column =
    columns.find((candidate) => candidate.id === target?.columnId) ??
    columns.find((candidate) => target?.columnTitle && candidate.title === target.columnTitle) ??
    columns[0];
  const swimlane =
    swimlanes.find((candidate) => candidate.id === target?.swimlaneId) ??
    swimlanes.find((candidate) => target?.swimlaneTitle && candidate.title === target.swimlaneTitle) ??
    swimlanes[0] ??
    null;

  const cards = kanban.get("cards");
  if (!cards) throw new CardError("TARGET_NOT_FOUND", "the kanban has no card matrix");
  const lastOrder = () => {
    let last = "";
    cards?.forEach((placement) => {
      if (
        String(placement.get("columnId")) === column.id &&
        String(placement.get("swimlaneId")) === (swimlane?.id ?? "")
      ) {
        const order = String(placement.get("order") ?? "");
        if (order > last) last = order;
      }
    });
    return last;
  };

  return { kanbanId, columnId: column.id, swimlaneId: swimlane?.id ?? null, cards, lastOrder };
}

/**
 * @returns {{created: Array<object>, skipped: Array<object>, count: number,
 *   target: object, mode: string}}
 */
export function convertToCards(
  ydoc,
  {
    selectionIds = [],
    target = { kind: "standalone" },
    mode = "copy",
    origin = { x: 0, y: 0 },
    agent = null,
    taskId = null,
    skill = "cards",
    maxCards = Number.POSITIVE_INFINITY,
    dryRun = false,
  } = {},
) {
  if (!Array.isArray(selectionIds) || selectionIds.length === 0) {
    throw new CardError("EMPTY_SELECTION", "select the objects to turn into cards");
  }
  if (selectionIds.length > CARD_LIMITS.maxPerTask) {
    throw new CardError(
      "CHANGE_SET_REQUIRED",
      `more than ${CARD_LIMITS.maxPerTask} objects need a change set`,
    );
  }
  if (mode !== "copy" && mode !== "move") {
    throw new CardError("BAD_MODE", "mode must be copy or move");
  }

  const planned = [];
  const skipped = [];
  for (const id of selectionIds) {
    const found = readText(ydoc, id);
    if (!found) {
      skipped.push({ sourceId: id, reason: "missing" });
      continue;
    }
    if (!found.text) {
      skipped.push({ sourceId: id, reason: found.reason ?? "empty" });
      continue;
    }
    // An agent never forces a lock: it skips the object and says so (ADR-107).
    if (found.widget?.locked) {
      skipped.push({ sourceId: id, reason: "locked" });
      continue;
    }
    if (found.text.length > CARD_LIMITS.text) {
      skipped.push({ sourceId: id, reason: "too_long" });
      continue;
    }
    planned.push({ sourceId: id, widget: found.widget, ...splitTitle(found.text), text: found.text });
  }
  if (!planned.length) throw new CardError("EMPTY_SELECTION", "nothing with text was selected");
  if (planned.length > maxCards) {
    throw new CardError(
      "BUDGET_ACTIONS",
      `the task allows ${maxCards} changes but ${planned.length} cards are needed`,
    );
  }

  const targetInfo =
    target?.kind === "kanban"
      ? { kind: "kanban", ...readKanban(ydoc, target) }
      : { kind: "standalone" };

  if (dryRun) {
    return {
      created: [],
      skipped,
      count: planned.length,
      mode,
      target:
        targetInfo.kind === "kanban"
          ? {
              kind: "kanban",
              kanbanId: targetInfo.kanbanId,
              columnId: targetInfo.columnId,
              swimlaneId: targetInfo.swimlaneId,
            }
          : { kind: "standalone" },
      dryRun: true,
    };
  }
  const now = Date.now();
  const author = agent ? `${agent.name} · AI` : "AI";
  const created = [];

  ydoc.transact(() => {
    let order = targetInfo.kind === "kanban" ? targetInfo.lastOrder() : "";
    planned.forEach((item, index) => {
      const id = makeId("card");
      const position =
        targetInfo.kind === "kanban"
          ? { x: 0, y: 0 }
          : {
              x: origin.x + (index % COLUMNS) * (CARD_WIDTH + GAP_X),
              y: origin.y + Math.floor(index / COLUMNS) * (CARD_HEIGHT + GAP_Y),
            };
      ydoc.getMap("widgets").set(id, {
        id,
        type: "card",
        parentId: targetInfo.kind === "kanban" ? targetInfo.kanbanId : null,
        ...position,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        title: item.title,
        ...(item.content ? { content: item.content } : {}),
        createdBy: author,
        createdAt: now,
        ...(agent ? { agent: { id: agent.id, name: agent.name, taskId, skill } } : {}),
      });
      const text = new Y.Text();
      text.insert(0, item.text);
      ydoc.getMap("texts").set(id, text);

      if (targetInfo.kind === "kanban") {
        order = orderBetween(order, undefined);
        const placement = new Y.Map();
        placement.set("columnId", targetInfo.columnId);
        placement.set("swimlaneId", targetInfo.swimlaneId ?? "");
        placement.set("order", order);
        targetInfo.cards.set(id, placement);
      }

      created.push({
        id,
        sourceId: item.sourceId,
        title: item.title,
        columnId: targetInfo.kind === "kanban" ? targetInfo.columnId : null,
        swimlaneId: targetInfo.kind === "kanban" ? targetInfo.swimlaneId : null,
      });
    });

    if (mode === "move") {
      for (const item of planned) {
        ydoc.getMap("widgets").delete(item.sourceId);
        ydoc.getMap("texts").delete(item.sourceId);
      }
    }
  });

  return {
    created,
    skipped,
    count: created.length,
    mode,
    target:
      targetInfo.kind === "kanban"
        ? {
            kind: "kanban",
            kanbanId: targetInfo.kanbanId,
            columnId: targetInfo.columnId,
            swimlaneId: targetInfo.swimlaneId,
          }
        : { kind: "standalone" },
  };
}
