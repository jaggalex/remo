/**
 * Tidy up a selection: the measured rules that turn scattered objects into columns.
 *
 * Pure geometry on purpose (ADR-143). A model may label blocks or choose a reading of
 * the selection, but it never computes a coordinate: the same items, strategy and area
 * always produce the same plan here. That is what lets the preview be honest, the unit
 * tests be exact, and the fallback be a real layout instead of "the model was busy".
 *
 * Coordinates are absolute centres (ADR-001), exactly like the rest of the model. The
 * engine never changes a size, a text or a connector: it only says where an object
 * should stand and which frame (existing or planned) owns it.
 */
import { PLAN_LIMITS, SELECTION_LIMITS, PlanError, isRecord } from "./limits.mjs";

export const TIDY_STRATEGIES = Object.freeze(["auto", "grid", "prefix", "type", "meaning"]);

/** Spacing between blocks and between a frame's edge and its contents. */
export const TIDY_GAP = 32;
export const TIDY_PADDING = 24;
/** The title band of a block frame: a frame is a section with a name (ADR-142). */
export const TIDY_TITLE = 44;
export const TIDY_MAX_COLUMNS = 8;

/** Visible names a type block gets. Board content, not a UI label (ADR-081). */
export const TIDY_TYPE_LABELS = Object.freeze({
  sticky_note: "Стикеры",
  text: "Текст",
  shape: "Фигуры",
  image: "Изображения",
  card: "Карточки",
  stamp: "Наклейки",
  frame: "Фреймы",
});

const OTHER_LABEL = "Прочее";

/* --------------------------------------------------------------- ordering --- */

/**
 * Natural order: `US-2` comes before `US-10`, and `US-10` before `US-10a`.
 *
 * A plain string compare gets this wrong in exactly the case a person notices, which
 * is why the strategy is called "by prefix" and not "alphabetically" (ADR-143).
 */
export function naturalCompare(a, b) {
  const left = String(a ?? "").toLowerCase().match(/\d+|\D+/g) ?? [];
  const right = String(b ?? "").toLowerCase().match(/\d+|\D+/g) ?? [];
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const first = left[index];
    const second = right[index];
    const firstNumber = /^\d+$/.test(first);
    const secondNumber = /^\d+$/.test(second);
    if (firstNumber && secondNumber) {
      const delta = Number(first) - Number(second);
      if (delta !== 0) return delta;
      // `02` and `2` are the same number; the shorter spelling wins as a tie-break.
      if (first.length !== second.length) return first.length - second.length;
      continue;
    }
    if (first !== second) return first < second ? -1 : 1;
  }
  return left.length - right.length;
}

const PREFIX = /^\s*([\p{L}][\p{L}\d _-]{0,15}?)\s*[-_.]?\s*(\d+)/u;

/** `"US-10: checkout"` → `{ label: "US", number: 10 }`. */
export function prefixOf(text) {
  const match = PREFIX.exec(String(text ?? ""));
  if (!match) return null;
  const label = match[1].trim().replace(/[\s_-]+$/u, "").toUpperCase();
  if (!label) return null;
  return { label, number: Number(match[2]) };
}

function itemText(item) {
  return String(item?.text ?? "").replace(/\s+/g, " ").trim();
}

/** A stable order for objects inside one block: number, then text, then id. */
function compareWithin(a, b) {
  const first = prefixOf(itemText(a));
  const second = prefixOf(itemText(b));
  if (first && second) {
    const difference = first.number - second.number;
    if (difference !== 0) return difference;
  } else if (first) return -1;
  else if (second) return 1;
  const byText = naturalCompare(itemText(a), itemText(b));
  if (byText !== 0) return byText;
  return naturalCompare(a.id, b.id);
}

/* ---------------------------------------------------------- classification --- */

function sortGroups(groups) {
  return groups
    .map((group) => ({
      ...group,
      items: [...group.items].sort(compareWithin),
    }))
    .sort((a, b) => naturalCompare(a.label, b.label));
}

/**
 * Columns by the prefix a person already wrote: one block per `US`, `API`, `BUG`.
 *
 * An object without a prefix is not dropped: it joins a block named after its type, so
 * a stray shape never disappears from the tidy.
 */
export function classifyByPrefix(items) {
  const groups = new Map();
  for (const item of items) {
    const parsed = prefixOf(itemText(item));
    const label = parsed ? parsed.label : (TIDY_TYPE_LABELS[item.type] ?? OTHER_LABEL);
    const key = `${parsed ? "prefix" : "type"}:${label}`;
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return sortGroups([...groups.values()]);
}

/** One block per kind, in the model's own order, with a visible name. */
export function classifyByType(items) {
  const order = Object.keys(TIDY_TYPE_LABELS);
  const groups = new Map();
  for (const item of items) {
    const label = TIDY_TYPE_LABELS[item.type] ?? OTHER_LABEL;
    const group = groups.get(item.type) ?? { key: `type:${item.type}`, label, items: [] };
    group.items.push(item);
    groups.set(item.type, group);
  }
  return [...groups.values()].sort((a, b) => {
    const first = order.indexOf(a.items[0]?.type);
    const second = order.indexOf(b.items[0]?.type);
    return (first < 0 ? 99 : first) - (second < 0 ? 99 : second);
  });
}

/**
 * The model's reading: named blocks of selected ids. Every id must come from the
 * selection, every label is plain text, and an object the model forgot still lands in
 * a block instead of being left behind.
 */
export function classifyByMeaning(items, labels) {
  if (!Array.isArray(labels) || labels.length === 0) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  const groups = [];
  for (const [index, entry] of labels.entries()) {
    if (!isRecord(entry)) continue;
    const label = String(entry.label ?? "").trim().slice(0, PLAN_LIMITS.titleLength);
    if (!label) continue;
    const members = [];
    for (const raw of Array.isArray(entry.ids) ? entry.ids : []) {
      const id = String(raw);
      const item = byId.get(id);
      if (!item || seen.has(id)) continue;
      seen.add(id);
      members.push(item);
    }
    if (!members.length) continue;
    groups.push({ key: `meaning:${index}`, label, items: members });
  }
  const rest = items.filter((item) => !seen.has(item.id));
  if (rest.length) {
    const leftover = classifyByType(rest);
    // Merge the leftovers into one block so "the model forgot three notes" is one
    // readable column, not one column per kind.
    groups.push({ key: "meaning:rest", label: OTHER_LABEL, items: leftover.flatMap((g) => g.items) });
  }
  return groups.map((group) => ({
    ...group,
    items: [...group.items].sort(compareWithin),
  }));
}

/** The strategy actually used, after `auto` and after a missing model answer. */
export function resolveStrategy(items, strategy = "auto", labels = null) {
  const requested = TIDY_STRATEGIES.includes(strategy) ? strategy : "auto";
  if (requested !== "auto") {
    if (requested === "meaning" && !(Array.isArray(labels) && labels.length)) return "prefix";
    return requested;
  }
  const prefixed = items.filter((item) => prefixOf(itemText(item)));
  if (prefixed.length >= Math.max(2, Math.ceil(items.length / 3))) return "prefix";
  return "type";
}

export function blocksFor(items, strategy, labels = null) {
  if (strategy === "prefix") return classifyByPrefix(items);
  if (strategy === "type") return classifyByType(items);
  if (strategy === "meaning") {
    const blocks = classifyByMeaning(items, labels);
    return blocks.length ? blocks : classifyByType(items);
  }
  return [];
}

/* ---------------------------------------------------------------- geometry --- */

function boxOf(centre) {
  return {
    x: centre.x - centre.width / 2,
    y: centre.y - centre.height / 2,
    width: centre.width,
    height: centre.height,
  };
}

function centreOf(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width: box.width,
    height: box.height,
  };
}

function overlap(a, b, margin = 0) {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  );
}

function clampToArea(box, area) {
  if (!area) return box;
  if (box.width > area.width + 0.5 || box.height > area.height + 0.5) {
    throw new PlanError(
      "TIDY_DOES_NOT_FIT",
      "the selection does not fit inside the frame at its current size; enlarge the frame or select fewer objects",
    );
  }
  return {
    ...box,
    x: Math.min(Math.max(box.x, area.x), area.x + area.width - box.width),
    y: Math.min(Math.max(box.y, area.y), area.y + area.height - box.height),
  };
}

function clampToWorld(box) {
  const limit = PLAN_LIMITS.coordinate;
  const x = Math.min(Math.max(box.x, -limit + box.width / 2), limit - box.width / 2);
  const y = Math.min(Math.max(box.y, -limit + box.height / 2), limit - box.height / 2);
  return { ...box, x, y };
}

function collides(box, boxes) {
  return boxes.some((other) => overlap(box, other, 1));
}

function normalise(items) {
  return items.map((item) => {
    if (!isRecord(item)) throw new PlanError("BAD_TIDY_ITEMS", "tidy items must be objects");
    const width = Number(item.width);
    const height = Number(item.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new PlanError("BAD_TIDY_ITEMS", "every tidy item needs a positive width and height");
    }
    return {
      id: String(item.id),
      type: String(item.type ?? ""),
      text: typeof item.text === "string" ? item.text : "",
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      width,
      height,
      parentId: item.parentId ? String(item.parentId) : null,
      containerId: item.containerId ? String(item.containerId) : null,
    };
  });
}

function placementOf(item, box, parentRef) {
  return {
    id: item.id,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    ...(parentRef ? { parentRef } : {}),
  };
}

function gridColumns(count, maxWidth, maxHeight, gap, area) {
  if (area) {
    const columns = Math.max(
      1,
      Math.floor((area.width + gap) / (maxWidth + gap)),
    );
    return Math.min(TIDY_MAX_COLUMNS, columns);
  }
  return Math.min(TIDY_MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(count))));
}

function gridLayout(items, { area, origin }) {
  const maxWidth = Math.max(...items.map((item) => item.width));
  const maxHeight = Math.max(...items.map((item) => item.height));
  let gap = TIDY_GAP;
  let columns = gridColumns(items.length, maxWidth, maxHeight, gap, area);
  let rows = Math.ceil(items.length / columns);
  let width = columns * maxWidth + (columns - 1) * gap;
  let height = rows * maxHeight + (rows - 1) * gap;

  // A frame is not resized (ADR-143): the layout tightens the gap first and refuses
  // only when the objects themselves cannot fit.
  if (area && (width > area.width + 0.5 || height > area.height + 0.5)) {
    for (const candidate of [16, 8, 4, 0]) {
      gap = candidate;
      columns = gridColumns(items.length, maxWidth, maxHeight, gap, area);
      rows = Math.ceil(items.length / columns);
      width = columns * maxWidth + (columns - 1) * gap;
      height = rows * maxHeight + (rows - 1) * gap;
      if (width <= area.width + 0.5 && height <= area.height + 0.5) break;
    }
  }
  if (area) {
    if (width > area.width + 0.5 || height > area.height + 0.5) {
      throw new PlanError(
        "TIDY_DOES_NOT_FIT",
        "the selection does not fit inside the frame at its current size; enlarge the frame or select fewer objects",
      );
    }
  }

  const start = area ? { x: area.x, y: area.y } : { x: origin.x, y: origin.y };
  const placements = [];
  for (const [index, item] of items.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const box = clampToWorld(
      clampToArea(
        {
          x: start.x + column * (maxWidth + gap),
          y: start.y + row * (maxHeight + gap),
          width: item.width,
          height: item.height,
        },
        area,
      ),
    );
    placements.push(placementOf(item, box, item.containerId));
  }
  return { placements, frames: [], blocks: [], warnings: [] };
}

/**
 * Blocks are frames, never groups (ADR-143): a group is a selection helper, a frame is
 * a visible named region a reader can move. A selected frame lays out inside itself,
 * where a nested frame is not allowed (ADR-110), so `createBlocks` is false there and
 * the same columns are drawn without frames.
 */
function blockLayout(items, blocks, { area, origin, foreign, createBlocks }) {
  const placedBoxes = [...foreign];
  const frames = [];
  const placements = [];
  const warnings = [];
  const titleHeight = createBlocks ? TIDY_TITLE : 0;
  const columns = Math.min(PLAN_LIMITS.blocks, blocks.length);
  let cursorX = origin.x;
  let cursorY = origin.y;
  let rowHeight = 0;
  let rowRight = area ? area.x + area.width : Infinity;

  for (const [index, block] of blocks.slice(0, columns).entries()) {
    const itemWidth = Math.max(...block.items.map((item) => item.width));
    const blockWidth = Math.max(160, itemWidth + TIDY_PADDING * 2);
    const contentHeight = block.items.reduce((sum, item) => sum + item.height, 0) +
      TIDY_GAP * Math.max(0, block.items.length - 1);
    const blockHeight = Math.max(
      120,
      titleHeight + TIDY_PADDING * 2 + contentHeight,
    );

    if (area && (blockWidth > area.width + 0.5 || blockHeight > area.height + 0.5)) {
      throw new PlanError(
        "TIDY_DOES_NOT_FIT",
        "the selection does not fit inside the frame at its current size; enlarge the frame or select fewer objects",
      );
    }

    // Next column; when the area ends, the next row. A block that would cover a
    // foreign object moves down instead — the stranger stays where it is (ADR-143).
    let box = { x: cursorX, y: cursorY, width: blockWidth, height: blockHeight };
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (area) {
        box = clampToArea(box, area);
      } else {
        box = clampToWorld(box);
      }
      if (!collides(box, placedBoxes)) break;
      box = { ...box, y: box.y + TIDY_GAP };
      if (area && box.y + blockHeight > area.y + area.height + 0.5) {
        throw new PlanError(
          "TIDY_DOES_NOT_FIT",
          "the selection does not fit inside the frame at its current size; enlarge the frame or select fewer objects",
        );
      }
    }
    if (collides(box, placedBoxes)) {
      throw new PlanError(
        "TIDY_BLOCKED",
        "there is no free space beside the selected objects; move the objects that are in the way",
      );
    }

    placedBoxes.push(box);
    cursorX = box.x + blockWidth + TIDY_GAP;
    rowHeight = Math.max(rowHeight, blockHeight);
    if (area && cursorX + blockWidth > rowRight + 0.5) {
      cursorX = area.x;
      cursorY += rowHeight + TIDY_GAP;
      rowHeight = 0;
    }

    const frameTempId = createBlocks ? `tidy_block_${index + 1}` : null;
    if (createBlocks) {
      frames.push({
        tempId: frameTempId,
        type: "frame",
        x: box.x + blockWidth / 2,
        y: box.y + blockHeight / 2,
        width: blockWidth,
        height: blockHeight,
        title: block.label.slice(0, PLAN_LIMITS.titleLength),
      });
    }

    let offsetY = box.y + titleHeight + TIDY_PADDING;
    for (const item of block.items) {
      const target = clampToWorld(
        clampToArea(
          {
            x: box.x + blockWidth / 2 - item.width / 2,
            y: offsetY,
            width: item.width,
            height: item.height,
          },
          area,
        ),
      );
      placements.push(
        placementOf(item, target, frameTempId ?? item.containerId ?? null),
      );
      offsetY += item.height + TIDY_GAP;
    }
  }

  return { placements, frames, blocks: blocks.slice(0, columns), warnings };
}

/** A whole grid shifts down as one block when a stranger is in its way (ADR-143). */
function shiftGridAway(result, items, foreign, area) {
  if (!foreign.length) return result;
  const sizeById = new Map(items.map((item) => [item.id, item]));
  const boxes = result.placements
    .map((placement) => {
      const size = sizeById.get(placement.id);
      if (!size) return null;
      return {
        x: placement.x - size.width / 2,
        y: placement.y - size.height / 2,
        width: size.width,
        height: size.height,
      };
    })
    .filter(Boolean);
  if (!boxes.length) return result;
  let dy = 0;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const moved = boxes.map((box) => ({ ...box, y: box.y + dy }));
    const blocked = moved.some((box) => collides(box, foreign));
    const outside =
      area &&
      moved.some(
        (box) =>
          box.y < area.y - 0.5 ||
          box.x < area.x - 0.5 ||
          box.y + box.height > area.y + area.height + 0.5 ||
          box.x + box.width > area.x + area.width + 0.5,
      );
    if (!blocked && !outside) {
      return {
        ...result,
        placements: result.placements.map((placement) => ({
          ...placement,
          y: placement.y + dy,
        })),
      };
    }
    dy += TIDY_GAP;
    if (outside || (area && dy > area.height)) break;
  }
  throw new PlanError(
    "TIDY_BLOCKED",
    "there is no free space beside the selected objects; move the objects that are in the way",
  );
}

/**
 * The one entry point the planner uses.
 *
 * `items` are already the movable set (groups expanded, frames' contents gathered,
 * locked objects removed by the caller); `foreign` are the boxes that must stay free.
 */
export function buildTidyLayout({
  items,
  strategy = "auto",
  labels = null,
  area = null,
  foreign = [],
  createBlocks = true,
  origin = { x: 0, y: 0 },
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PlanError("TIDY_EMPTY", "select at least one object to tidy");
  }
  if (items.length > SELECTION_LIMITS.objects) {
    throw new PlanError(
      "PLAN_TOO_LARGE",
      `tidy works on at most ${SELECTION_LIMITS.objects} objects; select fewer`,
    );
  }
  const movable = normalise(items);
  const used = resolveStrategy(movable, strategy, labels);
  if (used === "grid") {
    return {
      strategy: used,
      ...shiftGridAway(gridLayout(movable, { area, origin }), movable, foreign, area),
      bounds: null,
    };
  }
  const blocks = blocksFor(movable, used, labels);
  if (!blocks.length) {
    return {
      strategy: used,
      ...shiftGridAway(gridLayout(movable, { area, origin }), movable, foreign, area),
      bounds: null,
    };
  }
  const result = blockLayout(movable, blocks, {
    area,
    origin,
    foreign: Array.isArray(foreign) ? foreign : [],
    createBlocks,
  });
  return { strategy: used, ...result };
}

/** Bounds of placements and frames, for the preview sentence. */
export function tidyBounds(placements, frames, sizes) {
  const boxes = [];
  for (const placement of placements) {
    const size = sizes?.get?.(placement.id);
    if (!size) continue;
    boxes.push(boxOf({ ...placement, ...size }));
  }
  for (const frame of frames) boxes.push(boxOf(frame));
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export { centreOf, boxOf };
