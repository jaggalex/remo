/**
 * Reading a widget that came off the wire (ADR-171).
 *
 * The shared document is written by every client in the room, by older builds of this
 * one, by the sync service's commands and by agents. Yjs checks none of it: a value in
 * `widgets` is whatever the last writer put there. Until this module the snapshot handed
 * those values to React and the painters as `Widget`, so one malformed object — a
 * string where a number belongs, a `javascript:` link, a `style` that is an array — threw
 * in a painter and blanked the room for everyone in it, because everyone syncs it.
 *
 * The rule is "repair, keep, never throw":
 *
 * - A value that is not an object at all is not a widget; it is skipped (`null`).
 * - The identity fields are forced into shape: `id` is the map key, an unknown `type`
 *   becomes `unsupported` (which the canvas already paints as a placeholder), a
 *   coordinate that is not a finite number becomes 0.
 * - An optional field with the wrong shape is dropped, so the object falls back to its
 *   default for that field — exactly what an absent field already means.
 * - Fields this build does not know are kept: a newer client's data must survive an
 *   older reader (forward compatibility of the document).
 *
 * A valid widget is returned as the same object, without a copy, so the snapshot keeps
 * its referential stability and the common path costs a handful of `typeof` checks.
 *
 * This is a reader, not a validator for writes: it never changes the shared document.
 * Repairing on read keeps every client safe whoever wrote the value; repairing on write
 * would need every writer to cooperate, which is the assumption that failed.
 */
import { safeExternalUrl } from "./externalUrl";
import { WIDGET_KINDS } from "./kinds";
import { isTagColor, type Tag } from "./tags";
import { MAX_WAYPOINTS, type Widget } from "./types";

type Raw = Record<string, unknown>;

const STRING_FIELDS = [
  "groupId",
  "content",
  "title",
  "name",
  "assigneeId",
  "assigneeName",
  "startAt",
  "dueAt",
  "label",
  "createdBy",
  "lockedBy",
  "lockedByName",
] as const;

const NUMBER_FIELDS = ["z", "createdAt", "lockedAt", "bend"] as const;

const BOOLEAN_FIELDS = ["locked", "elbowFlip"] as const;

/**
 * Fields the model no longer has (ADR-209): a reader drops them instead of preserving
 * them as unknown data, so an old document gets smaller rather than carrying a value
 * nothing can read.
 */
const REMOVED_FIELDS = ["rotation"] as const;
const REMOVED_STYLE_FIELDS = ["fontFamily"] as const;

const ENUM_FIELDS: Record<string, ReadonlySet<string>> = {
  status: new Set(["todo", "in_progress", "done"]),
  shapeKind: new Set(["rectangle", "round_rectangle", "ellipse", "diamond", "triangle"]),
  arrow: new Set(["none", "end", "both", "start"]),
  routing: new Set(["straight", "elbow", "curved"]),
  connectorShape: new Set(["straight", "elbowed", "curved"]),
};

const STYLE_STRINGS = ["fillColor", "cardTheme", "strokeColor", "color", "textColor"];
const STYLE_POSITIVE = ["strokeWidth", "fontSize"];
const STYLE_ENUMS: Record<string, ReadonlySet<string>> = {
  strokeStyle: new Set(["normal", "dashed", "dotted"]),
  textAlign: new Set(["left", "center", "right"]),
  textVAlign: new Set(["top", "middle", "bottom"]),
  stickySize: new Set(["S", "M", "L"]),
};

const SIDES = new Set(["left", "right", "top", "bottom"]);
const TIMER_STATES = new Set(["idle", "running", "paused"]);

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Copy-on-first-write: a valid widget is never copied. */
class Repair {
  private copy: Raw | null = null;

  constructor(private readonly source: Raw) {}

  set(key: string, value: unknown): void {
    this.copy ??= { ...this.source };
    this.copy[key] = value;
  }

  drop(key: string): void {
    if (!(key in (this.copy ?? this.source))) return;
    this.copy ??= { ...this.source };
    delete this.copy[key];
  }

  get result(): Raw {
    return this.copy ?? this.source;
  }
}

function readStyle(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const repair = new Repair(value);
  for (const key of REMOVED_STYLE_FIELDS) repair.drop(key);
  for (const key of STYLE_STRINGS) {
    if (key in value && typeof value[key] !== "string") repair.drop(key);
  }
  for (const key of STYLE_POSITIVE) {
    if (key in value && !(isFiniteNumber(value[key]) && (value[key] as number) > 0)) {
      repair.drop(key);
    }
  }
  for (const [key, allowed] of Object.entries(STYLE_ENUMS)) {
    if (key in value && !(typeof value[key] === "string" && allowed.has(value[key] as string))) {
      repair.drop(key);
    }
  }
  return repair.result;
}

function validEnd(value: unknown): boolean {
  if (!isObject(value) || typeof value.item !== "string") return false;
  if (value.side !== undefined && !(typeof value.side === "string" && SIDES.has(value.side))) {
    return false;
  }
  return value.offset === undefined || isFiniteNumber(value.offset);
}

function validWaypoint(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    (value.rigid === undefined || typeof value.rigid === "boolean")
  );
}

function validTimer(value: unknown): boolean {
  return (
    isObject(value) &&
    isFiniteNumber(value.durationMs) &&
    (value.endsAt === null || typeof value.endsAt === "string") &&
    (value.remainingMs === null || isFiniteNumber(value.remainingMs)) &&
    typeof value.state === "string" &&
    TIMER_STATES.has(value.state) &&
    typeof value.setBy === "string"
  );
}

function validRun(value: unknown): boolean {
  return isObject(value) && typeof value.text === "string";
}

const AXIS_SIZES = new Set(["auto", "narrow", "medium", "wide"]);

function validAxis(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.size === undefined ||
      (typeof value.size === "string" && AXIS_SIZES.has(value.size)) ||
      (isFiniteNumber(value.size) && value.size > 0)) &&
    (value.vertical === undefined || typeof value.vertical === "boolean")
  );
}

function readFillMap(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const output: Raw = {};
  for (const [key, fill] of Object.entries(value)) {
    if (typeof fill === "string") output[key] = fill;
  }
  return output;
}

const BORDER_STYLES = new Set(["solid", "dashed", "none"]);

function readBorder(value: unknown): Raw | undefined {
  if (!isObject(value) || typeof value.color !== "string") return undefined;
  if (!isFiniteNumber(value.width) || value.width < 0 || value.width > 8) return undefined;
  if (typeof value.style !== "string" || !BORDER_STYLES.has(value.style)) return undefined;
  return { color: value.color, width: value.width, style: value.style };
}

function readBorderMap(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const output: Raw = {};
  for (const [key, border] of Object.entries(value)) {
    const read = readBorder(border);
    if (read) output[key] = read;
  }
  return output;
}

function readBorders(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const output: Raw = {};
  for (const key of ["table", "headers"] as const) {
    const border = readBorder(value[key]);
    if (border) output[key] = border;
  }
  for (const key of ["columns", "rows", "cells"] as const) {
    const map = readBorderMap(value[key]);
    if (map) output[key] = map;
  }
  return Object.keys(output).length ? output : undefined;
}

function readPadding(value: unknown): number | undefined {
  if (!isFiniteNumber(value) || value < 0 || value > 96) return undefined;
  return value;
}

function readPaddingMap(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const output: Raw = {};
  for (const [key, padding] of Object.entries(value)) {
    const read = readPadding(padding);
    if (read != null) output[key] = read;
  }
  return output;
}

function readPaddings(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const output: Raw = {};
  for (const key of ["table", "headers"] as const) {
    const padding = readPadding(value[key]);
    if (padding != null) output[key] = padding;
  }
  for (const key of ["columns", "rows", "cells"] as const) {
    const map = readPaddingMap(value[key]);
    if (map) output[key] = map;
  }
  return Object.keys(output).length ? output : undefined;
}

function readLayout(value: unknown): Raw | undefined {
  if (!isObject(value) || value.kind !== "table") return undefined;
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) return undefined;
  const seen = new Set<string>();
  const axes = (list: unknown[]): Raw[] => {
    const output: Raw[] = [];
    for (const entry of list) {
      if (!validAxis(entry)) continue;
      const axis = entry as Raw;
      const id = axis.id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      output.push(axis);
    }
    return output;
  };
  const columns = axes(value.columns);
  const rows = axes(value.rows);
  if (!columns.length || !rows.length) return undefined;
  const layout: Raw = { kind: "table", columns, rows };
  if (typeof value.active === "boolean") layout.active = value.active;
  if (isObject(value.appearance)) {
    const appearance: Raw = {};
    for (const key of ["table", "headers"] as const) {
      if (typeof value.appearance[key] === "string") appearance[key] = value.appearance[key];
    }
    for (const key of ["columns", "rows", "cells"] as const) {
      const map = readFillMap(value.appearance[key]);
      if (map) appearance[key] = map;
    }
    const borders = readBorders(value.appearance.borders);
    if (borders) appearance.borders = borders;
    const paddings = readPaddings(value.appearance.paddings);
    if (paddings) appearance.paddings = paddings;
    if (Object.keys(appearance).length) layout.appearance = appearance;
  }
  const spans = readSpans(value.spans, columns, rows);
  if (spans.length) layout.spans = spans;
  return layout;
}

function positiveInt(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(number) && number >= 1 ? number : null;
}

/**
 * Merged blocks that can be drawn (ADR-204): the anchor exists, the block stays inside
 * the axes, and no cell is covered twice. A malformed span is dropped, never repaired
 * into a different rectangle.
 */
function readSpans(value: unknown, columns: Raw[], rows: Raw[]): Raw[] {
  if (!Array.isArray(value)) return [];
  const columnIndex = new Map(columns.map((axis, index) => [axis.id as string, index]));
  const rowIndex = new Map(rows.map((axis, index) => [axis.id as string, index]));
  const covered = new Set<string>();
  const output: Raw[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const { rowId, columnId } = entry;
    if (typeof rowId !== "string" || typeof columnId !== "string") continue;
    const rowSpan = positiveInt(entry.rowSpan);
    const columnSpan = positiveInt(entry.columnSpan);
    if (rowSpan == null || columnSpan == null) continue;
    if (rowSpan * columnSpan < 2) continue;
    const top = rowIndex.get(rowId);
    const left = columnIndex.get(columnId);
    if (top == null || left == null) continue;
    if (top + rowSpan > rows.length || left + columnSpan > columns.length) continue;
    let overlaps = false;
    for (let r = top; r < top + rowSpan && !overlaps; r += 1) {
      for (let c = left; c < left + columnSpan; c += 1) {
        if (covered.has(`${r}:${c}`)) {
          overlaps = true;
          break;
        }
      }
    }
    if (overlaps) continue;
    for (let r = top; r < top + rowSpan; r += 1) {
      for (let c = left; c < left + columnSpan; c += 1) covered.add(`${r}:${c}`);
    }
    output.push({ rowId, columnId, rowSpan, columnSpan });
  }
  return output;
}

function readCell(value: unknown): Raw | undefined {
  if (!isObject(value) || typeof value.rowId !== "string" || typeof value.columnId !== "string") {
    return undefined;
  }
  return { rowId: value.rowId, columnId: value.columnId };
}

/** A link this build can open safely, or null. */
function readLink(value: unknown): Raw | null {
  if (!isObject(value)) return null;
  if (value.kind === "widget") {
    return typeof value.widgetId === "string" ? value : null;
  }
  if (value.kind === "url" && typeof value.url === "string") {
    const url = safeExternalUrl(value.url);
    if (!url) return null;
    return url === value.url ? value : { kind: "url", url };
  }
  return null;
}

/**
 * The widget stored under `id`, repaired into a shape the app can render, or null when
 * the value is not an object at all.
 */
export function readWidget(raw: unknown, id: string): Widget | null {
  if (!isObject(raw)) return null;
  const repair = new Repair(raw);

  if (raw.id !== id) repair.set("id", id);
  // `hasOwn`, not `in`: `"constructor" in WIDGET_KINDS` is true through the prototype.
  if (typeof raw.type !== "string" || !Object.hasOwn(WIDGET_KINDS, raw.type)) {
    repair.set("type", "unsupported");
  }
  for (const key of ["x", "y"] as const) {
    if (!isFiniteNumber(raw[key])) repair.set(key, 0);
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(raw[key]) || (raw[key] as number) < 0) repair.set(key, 0);
  }
  if (raw.parentId !== null && typeof raw.parentId !== "string") repair.set("parentId", null);

  for (const key of STRING_FIELDS) {
    if (key in raw && typeof raw[key] !== "string") repair.drop(key);
  }
  for (const key of NUMBER_FIELDS) {
    if (key in raw && !isFiniteNumber(raw[key])) repair.drop(key);
  }
  for (const key of BOOLEAN_FIELDS) {
    if (key in raw && typeof raw[key] !== "boolean") repair.drop(key);
  }
  for (const key of REMOVED_FIELDS) repair.drop(key);
  for (const [key, allowed] of Object.entries(ENUM_FIELDS)) {
    if (key in raw && !(typeof raw[key] === "string" && allowed.has(raw[key] as string))) {
      repair.drop(key);
    }
  }

  if ("tagIds" in raw && !isStringArray(raw.tagIds)) {
    if (Array.isArray(raw.tagIds)) {
      repair.set(
        "tagIds",
        raw.tagIds.filter((entry): entry is string => typeof entry === "string"),
      );
    } else {
      repair.drop("tagIds");
    }
  }

  if ("link" in raw) {
    const link = readLink(raw.link);
    if (!link) repair.drop("link");
    else if (link !== raw.link) repair.set("link", link);
  }

  if ("style" in raw) {
    const style = readStyle(raw.style);
    if (!style) repair.drop("style");
    else if (style !== raw.style) repair.set("style", style);
  }

  if ("runs" in raw) {
    if (!Array.isArray(raw.runs)) repair.drop("runs");
    else if (!raw.runs.every(validRun)) repair.set("runs", raw.runs.filter(validRun));
  }

  if ("layout" in raw) {
    const layout = readLayout(raw.layout);
    if (!layout) repair.drop("layout");
    else if (layout !== raw.layout) repair.set("layout", layout);
  }

  if ("cell" in raw) {
    const cell = readCell(raw.cell);
    if (!cell) repair.drop("cell");
    else if (cell !== raw.cell) repair.set("cell", cell);
  }

  for (const key of ["start", "end"] as const) {
    if (key in raw && !validEnd(raw[key])) repair.drop(key);
  }

  if ("waypoints" in raw) {
    if (!Array.isArray(raw.waypoints)) {
      repair.drop("waypoints");
    } else if (!raw.waypoints.every(validWaypoint) || raw.waypoints.length > MAX_WAYPOINTS) {
      repair.set("waypoints", raw.waypoints.filter(validWaypoint).slice(0, MAX_WAYPOINTS));
    }
  }

  if ("timer" in raw && !validTimer(raw.timer)) repair.drop("timer");

  if (
    "agent" in raw &&
    !(isObject(raw.agent) && typeof raw.agent.id === "string" && typeof raw.agent.name === "string")
  ) {
    repair.drop("agent");
  }

  if (
    "labelAt" in raw &&
    !(
      isObject(raw.labelAt) &&
      (raw.labelAt.t === undefined || isFiniteNumber(raw.labelAt.t)) &&
      (raw.labelAt.offset === undefined || isFiniteNumber(raw.labelAt.offset))
    )
  ) {
    repair.drop("labelAt");
  }

  if (
    "curve" in raw &&
    !(isObject(raw.curve) && isFiniteNumber(raw.curve.from) && isFiniteNumber(raw.curve.to))
  ) {
    repair.drop("curve");
  }

  return repair.result as unknown as Widget;
}

/** A board tag, repaired; null when the value is not a tag at all. */
export function readTag(raw: unknown, id: string): Tag | null {
  if (!isObject(raw) || typeof raw.name !== "string") return null;
  const color = typeof raw.color === "string" && isTagColor(raw.color) ? raw.color : "gray";
  if (raw.id === id && raw.color === color) return raw as unknown as Tag;
  return { ...(raw as unknown as Tag), id, color };
}

/** A finite number from the wire, or the fallback. */
export function finiteOr(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
