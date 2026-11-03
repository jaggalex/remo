/**
 * A selection read as **source** (ADR-143).
 *
 * Two readers share this module. The task surface turns a selection into what a model
 * may see: plain texts, kinds, boxes and the lines between selected objects, ordered
 * top-down and left-right. The tidy runner needs the same expansion plus the frame a
 * block is laid out inside. One expansion means the preview, the prompt and the plan
 * cannot disagree about what "the selection" is.
 *
 * Everything here is data. A note that says "ignore previous instructions" is a string
 * with a coordinate, never an instruction (ADR-142 "Untrusted content").
 */
import { SELECTION_LIMITS } from "@remo/agent-plan";

const FRAME_PAD = 24;
const FRAME_HEADER = 44;

function textOf(texts, widget) {
  const editable = texts?.get?.(String(widget.id));
  const value =
    editable && typeof editable.toString === "function"
      ? editable.toString()
      : widget.title ?? widget.content ?? "";
  return String(value ?? "");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : fallback;
}

function snapshot(widget, texts) {
  return {
    id: String(widget.id),
    type: String(widget.type),
    text: textOf(texts, widget).trim(),
    x: finite(widget.x),
    y: finite(widget.y),
    width: finite(widget.width),
    height: finite(widget.height),
    parentId: widget.parentId ? String(widget.parentId) : null,
    groupId: widget.groupId ? String(widget.groupId) : null,
    locked: widget.locked === true,
  };
}

/** Top-down, then left-right: the order a person reads a board (ADR-143). */
export function readingOrder(a, b) {
  if (Math.abs(a.y - b.y) > 0.5) return a.y - b.y;
  if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Groups are expanded to their members and frames to everything they contain.
 *
 * A group is a selection helper: selecting one member means the group. A frame is a
 * container: selecting it means its contents. The result is deduplicated, because a
 * selected frame and a selected child name the same object twice.
 */
export function expandSelection(ydoc, selectionIds) {
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const requested = Array.isArray(selectionIds) ? selectionIds.map(String) : [];
  const groups = new Set();
  for (const id of requested) {
    const widget = widgets.get(id);
    if (widget?.groupId) groups.add(String(widget.groupId));
  }

  const chosen = new Set();
  const add = (id) => {
    const widget = widgets.get(id);
    if (!widget) return;
    if (widget.type === "connector") return;
    chosen.add(String(id));
  };
  for (const id of requested) add(id);
  if (groups.size) {
    widgets.forEach((widget, id) => {
      if (widget.groupId && groups.has(String(widget.groupId))) add(id);
    });
  }

  // Frames own their contents: selecting a frame selects the whole frame, not its
  // chrome. Walk the parent map rather than trusting a child list, so a malformed
  // board cannot hide an object from the expansion.
  const selectedFrames = [...chosen].filter((id) => widgets.get(id)?.type === "frame");
  if (selectedFrames.length) {
    const frameSet = new Set(selectedFrames);
    widgets.forEach((widget, id) => {
      let parent = widget.parentId ? String(widget.parentId) : null;
      const seen = new Set();
      while (parent && !seen.has(parent)) {
        if (frameSet.has(parent)) {
          if (widget.type !== "connector") chosen.add(String(id));
          break;
        }
        seen.add(parent);
        parent = widgets.get(parent)?.parentId ?? null;
      }
    });
  }

  const objects = [];
  chosen.forEach((id) => {
    const widget = widgets.get(id);
    if (widget) objects.push(snapshot(widget, texts));
  });
  objects.sort(readingOrder);

  const connectors = [];
  const chosenIds = new Set(objects.map((object) => object.id));
  widgets.forEach((widget, id) => {
    if (widget.type !== "connector") return;
    const from = widget.start?.item ? String(widget.start.item) : "";
    const to = widget.end?.item ? String(widget.end.item) : "";
    if (from && to && chosenIds.has(from) && chosenIds.has(to)) {
      connectors.push({ id: String(id), from, to });
    }
  });

  return {
    objects,
    connectors,
    frames: objects.filter((object) => object.type === "frame").map((object) => object.id),
    groups: [...groups],
  };
}

function cutText(text, remaining) {
  if (text.length <= remaining) return { text, cut: false };
  if (remaining <= 0) return { text: "", cut: true };
  const slice = text.slice(0, remaining);
  const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  const kept = (boundary > remaining * 0.6 ? slice.slice(0, boundary) : slice).trimEnd();
  return { text: kept, cut: true };
}

/**
 * What a model may see of a selection: at most fifty objects and twenty thousand
 * characters, empty texts and repeated texts dropped, the tail cut and reported.
 */
export function buildSelectionSource(ydoc, selectionIds, limits = SELECTION_LIMITS) {
  const expanded = expandSelection(ydoc, selectionIds);
  const seenTexts = new Set();
  const objects = [];
  const texts = [];
  let chars = 0;
  let empty = 0;
  let duplicates = 0;
  let truncated = false;

  for (const object of expanded.objects) {
    if (objects.length >= limits.objects) {
      truncated = true;
      break;
    }
    const text = object.text.replace(/\s+/g, " ").trim();
    if (!text) {
      empty += 1;
      objects.push({ ...object, text: "" });
      continue;
    }
    if (seenTexts.has(text)) {
      duplicates += 1;
      continue;
    }
    seenTexts.add(text);
    const remaining = limits.chars - chars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const cut = cutText(text, remaining);
    chars += cut.text.length;
    if (cut.cut) truncated = true;
    objects.push({ ...object, text: cut.text });
    texts.push(cut.text);
    if (cut.cut) break;
  }

  return {
    objects,
    // The movable set is the whole expansion, not the model's de-duplicated view: an
    // empty note or a repeated sentence is still an object tidy may move (ADR-143).
    allowedIds: expanded.objects.map((object) => object.id),
    texts,
    connectors: expanded.connectors,
    frames: expanded.objects
      .filter((object) => object.type === "frame")
      .map((object) => object.id),
    groups: expanded.groups,
    counts: {
      selected: Array.isArray(selectionIds) ? selectionIds.length : 0,
      expanded: expanded.objects.length,
      included: objects.length,
      texts: texts.length,
      connectors: expanded.connectors.length,
      chars,
      empty,
      duplicates,
      frames: expanded.objects.filter((object) => object.type === "frame").length,
      groups: expanded.groups.length,
    },
    truncated,
    ...(truncated ? { truncationCode: "SELECTION_TRUNCATED" } : {}),
  };
}

/** The same source as one stored input row: JSON text, never the board itself. */
export function selectionInput(source) {
  return {
    source: "selection",
    name: "selection",
    kind: "text",
    content: JSON.stringify(source),
    bytes: source.counts.chars,
    chars: source.counts.chars,
    truncated: source.truncated === true,
    truncation_code: source.truncationCode ?? null,
  };
}

/** Read a stored selection row back; a broken row is "no selection", not a crash. */
export function readSelectionInput(input) {
  if (!input?.content) return null;
  try {
    const parsed = JSON.parse(input.content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The inner rectangle of a frame: below its title band, inside its padding. */
export function frameArea(frame) {
  return {
    x: frame.x - frame.width / 2 + FRAME_PAD,
    y: frame.y - frame.height / 2 + FRAME_HEADER,
    width: Math.max(0, frame.width - FRAME_PAD * 2),
    height: Math.max(0, frame.height - FRAME_HEADER - FRAME_PAD),
  };
}

/**
 * The movable set of a tidy, split by where it lives.
 *
 * - each selected frame is a group laid out **inside** itself (ADR-143);
 * - selected free objects form one group that may get block frames;
 * - a selected child of an unselected frame stays put: tidy does not detach an object
 *   from a container the person did not select;
 * - connectors are never placed.
 */
export function tidyGroups(ydoc, selectionIds) {
  const widgets = ydoc.getMap("widgets");
  const expanded = expandSelection(ydoc, selectionIds);
  const byId = new Map(expanded.objects.map((object) => [object.id, object]));
  const frameIds = expanded.objects
    .filter((object) => object.type === "frame")
    .map((object) => object.id);
  const frameSet = new Set(frameIds);
  const groups = [];
  const moved = new Set();

  const parentOf = (id) => widgets.get(id)?.parentId ?? null;
  const insideSelectedFrame = (id) => {
    let parent = parentOf(id);
    const seen = new Set();
    while (parent && !seen.has(parent)) {
      if (frameSet.has(parent)) return true;
      seen.add(parent);
      parent = parentOf(parent);
    }
    return false;
  };

  for (const frameId of frameIds) {
    const frameWidget = widgets.get(frameId);
    if (!frameWidget) continue;
    const items = expanded.objects.filter(
      (object) => object.id !== frameId && insideSelectedFrame(object.id),
    );
    const area = frameArea({
      x: finite(frameWidget.x),
      y: finite(frameWidget.y),
      width: finite(frameWidget.width),
      height: finite(frameWidget.height),
    });
    groups.push({
      kind: "frame",
      frameId,
      frame: {
        id: frameId,
        x: finite(frameWidget.x),
        y: finite(frameWidget.y),
        width: finite(frameWidget.width),
        height: finite(frameWidget.height),
      },
      area,
      items: items.map((item) => ({ ...item, containerId: frameId })),
    });
    for (const item of items) moved.add(item.id);
  }

  // Selected children of an **unselected** frame are still ours to move: they stay
  // inside their parent. Tidy them inside that frame instead of skipping everything,
  // which used to end in TIDY_EMPTY when a marquee started inside a big frame.
  const implicitFrames = new Set();
  for (const object of expanded.objects) {
    if (object.type === "frame" || moved.has(object.id)) continue;
    const parent = object.parentId;
    if (!parent || frameSet.has(parent)) continue;
    const frame = widgets.get(parent);
    if (frame?.type === "frame") implicitFrames.add(parent);
  }
  for (const frameId of implicitFrames) {
    const frameWidget = widgets.get(frameId);
    if (!frameWidget) continue;
    const items = expanded.objects.filter(
      (object) =>
        object.id !== frameId && object.parentId === frameId && !moved.has(object.id),
    );
    if (!items.length) continue;
    groups.push({
      kind: "frame",
      frameId,
      frame: {
        id: frameId,
        x: finite(frameWidget.x),
        y: finite(frameWidget.y),
        width: finite(frameWidget.width),
        height: finite(frameWidget.height),
      },
      area: frameArea({
        x: finite(frameWidget.x),
        y: finite(frameWidget.y),
        width: finite(frameWidget.width),
        height: finite(frameWidget.height),
      }),
      items: items.map((item) => ({ ...item, containerId: frameId })),
    });
    for (const item of items) moved.add(item.id);
  }

  const free = expanded.objects.filter((object) => {
    if (object.type === "frame") return false;
    if (moved.has(object.id)) return false;
    // Anything still parented is inside a frame we did not select and that had no
    // selected children: leave it alone.
    return !object.parentId;
  });

  const skipped = expanded.objects.filter(
    (object) =>
      object.type !== "frame" &&
      !moved.has(object.id) &&
      object.parentId &&
      !frameSet.has(object.parentId),
  );

  if (free.length) {
    for (const item of free) moved.add(item.id);
    const bounds = free.reduce(
      (acc, item) => ({
        minX: Math.min(acc.minX, item.x - item.width / 2),
        minY: Math.min(acc.minY, item.y - item.height / 2),
        maxX: Math.max(acc.maxX, item.x + item.width / 2),
        maxY: Math.max(acc.maxY, item.y + item.height / 2),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    groups.push({
      kind: "free",
      frameId: null,
      frame: null,
      area: null,
      origin: { x: bounds.minX, y: bounds.minY },
      items: free,
    });
  }

  // Everything that is not ours to move is an obstacle, including a selected frame
  // when the free group is laid out beside it.
  const movable = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
  const foreign = [];
  widgets.forEach((widget, id) => {
    const key = String(id);
    if (widget.type === "connector" || movable.has(key)) return;
    if (insideSelectedFrame(key)) return;
    // The parent of an implicit group is its area, not an obstacle inside itself.
    if (implicitFrames.has(key)) return;
    foreign.push({
      id: key,
      x: finite(widget.x),
      y: finite(widget.y),
      width: finite(widget.width),
      height: finite(widget.height),
    });
  });

  return {
    groups,
    moved: [...moved],
    free: free.map((item) => item.id),
    skipped: skipped.map((item) => item.id),
    foreign,
    frames: frameIds,
    expanded,
  };
}
