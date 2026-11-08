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

const NUMBER_FIELDS = ["rotation", "z", "createdAt", "lockedAt", "bend"] as const;

const BOOLEAN_FIELDS = ["locked", "elbowFlip"] as const;

const ENUM_FIELDS: Record<string, ReadonlySet<string>> = {
  status: new Set(["todo", "in_progress", "done"]),
  shapeKind: new Set(["rectangle", "round_rectangle", "ellipse", "diamond", "triangle"]),
  arrow: new Set(["none", "end", "both", "start"]),
  routing: new Set(["straight", "elbow", "curved"]),
  connectorShape: new Set(["straight", "elbowed", "curved"]),
};

const STYLE_STRINGS = ["fillColor", "cardTheme", "strokeColor", "fontFamily", "color", "textColor"];
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
