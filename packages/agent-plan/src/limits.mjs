/**
 * The agent authoring contract: limits, error codes and the fields a plan may carry.
 *
 * A model writes the operations; the server validates them and the client applies the
 * resulting plan. Anything this file does not name is an error, not a field the
 * document would silently ignore (ADR-142).
 *
 * Plain ESM on purpose: `apps/sync` has no build step and the web must apply the same
 * plan, so the rules live in one module both runtimes can load (the `@remo/metrics`
 * pattern).
 */

export const PLAN_LIMITS = Object.freeze({
  /** Operations in one authoring request. */
  operations: 10,
  /** Objects one plan may create. A gesture, not a bulk import. */
  objects: 300,
  /** Connectors one plan may create. */
  connectors: 100,
  /** Columns of a user story map. */
  columns: 12,
  /** Stories in one column. */
  storiesPerColumn: 50,
  /** Named swimlanes in one story map. */
  swimlanes: 6,
  /** Sticker rows one swimlane may declare. */
  rowsPerSwimlane: 4,
  /** Temp ids are short and greppable, not arbitrary strings. */
  tempIdLength: 64,
  /** An id an operation refers to (a tempId or an existing object id). */
  idLength: 200,
  /** Absolute canvas coordinate bound, in both axes. */
  coordinate: 1_000_000,
  /** Smallest planned box width, except a frame which has the model's own floor. */
  minSize: 80,
  /** Smallest planned box height. */
  minHeight: 60,
  /** Largest planned box. */
  maxSize: 20_000,
  /** Above this a dry run warns that the plan is close to the ceiling. */
  warnObjects: 200,
  /** A frame or story lane title. */
  titleLength: 200,
  /** Text of one object. */
  textLength: 2_000,
  /** Blocks one tidy plan may frame. A block is a column, not a group (ADR-143). */
  blocks: 12,
});

/**
 * What a selection may contribute to a task (ADR-143).
 *
 * A person may select a whole frame; the source then expands to its contents. The cap
 * keeps a model prompt a prompt and not a copy of the board: fifty objects, twenty
 * thousand characters, with the tail cut at a boundary and reported.
 */
export const SELECTION_LIMITS = Object.freeze({
  objects: 50,
  chars: 20_000,
});

/** The only object kinds an agent may create in M1 (ADR-142). */
export const PLANNED_TYPES = Object.freeze(["sticky_note", "text", "shape", "frame"]);
export const PLANNED_TYPE_SET = new Set(PLANNED_TYPES);

/**
 * Kinds a connector may join after creation.
 *
 * Mirrors `WIDGET_KINDS[type].connectable`; a frame is a container and a connector to
 * one is a line across the board (ADR-072). `packages/doc` has a guard test that keeps
 * this list equal to the model's capability table.
 */
export const CONNECTABLE_TYPES = Object.freeze([
  "sticky_note",
  "text",
  "shape",
  "card",
  "image",
  "stamp",
]);
export const CONNECTABLE_TYPE_SET = new Set(CONNECTABLE_TYPES);

export const SHAPE_KINDS = Object.freeze([
  "rectangle",
  "round_rectangle",
  "ellipse",
  "diamond",
  "triangle",
]);
export const SHAPE_KIND_SET = new Set(SHAPE_KINDS);

export const ROUTINGS = Object.freeze(["straight", "elbow", "curved"]);
export const ROUTING_SET = new Set(ROUTINGS);

export const ARROWS = Object.freeze(["none", "end", "both", "start"]);
export const ARROW_SET = new Set(ARROWS);

/** A coded refusal, like `ChangeSetError`: the route maps `code` to one message. */
export class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlanError";
    this.code = code;
  }
}

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A finite number inside a range, or a coded refusal. */
export function finiteIn(value, min, max, code, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new PlanError(code, message);
  }
  return number;
}

export function textField(value, { code, field, max, required = false }) {
  if (value === undefined || value === null) {
    if (required) throw new PlanError(code, `${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new PlanError(code, `${field} must be a string`);
  const text = value.trim();
  if (!text) {
    if (required) throw new PlanError(code, `${field} must not be empty`);
    return undefined;
  }
  if (text.length > max) {
    throw new PlanError(code, `${field} is longer than ${max} characters`);
  }
  return text;
}

const STRING_STYLE_FIELDS = new Set(["fillColor", "cardTheme", "strokeColor", "fontFamily", "color", "textColor"]);
const NUMBER_STYLE_FIELDS = new Map([
  ["strokeWidth", [0, 32]],
  ["fontSize", [4, 400]],
]);
const ENUM_STYLE_FIELDS = new Map([
  ["strokeStyle", new Set(["normal", "dashed", "dotted"])],
  ["textAlign", new Set(["left", "center", "right"])],
  ["textVAlign", new Set(["top", "middle", "bottom"])],
  ["stickySize", new Set(["S", "M", "L"])],
]);

/**
 * Copy only the style fields the model knows.
 *
 * A model that invents `shadow` or `opacity` gets a refusal instead of a value the
 * document would ignore — the plan must say what will actually happen (ADR-142).
 */
export function cleanStyle(value, { code = "BAD_STYLE", allowed = null } = {}) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new PlanError(code, "style must be an object");
  const style = {};
  for (const [key, raw] of Object.entries(value)) {
    if (allowed && !allowed.has(key)) {
      throw new PlanError(code, `style.${key} is not allowed here`);
    }
    if (STRING_STYLE_FIELDS.has(key)) {
      if (typeof raw !== "string" || !raw.trim() || raw.length > 64) {
        throw new PlanError(code, `style.${key} must be a short string`);
      }
      style[key] = raw;
      continue;
    }
    const range = NUMBER_STYLE_FIELDS.get(key);
    if (range) {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < range[0] || number > range[1]) {
        throw new PlanError(code, `style.${key} must be between ${range[0]} and ${range[1]}`);
      }
      style[key] = number;
      continue;
    }
    const values = ENUM_STYLE_FIELDS.get(key);
    if (values) {
      if (!values.has(raw)) {
        throw new PlanError(code, `style.${key} must be one of ${[...values].join(", ")}`);
      }
      style[key] = raw;
      continue;
    }
    throw new PlanError(code, `style.${key} is not a known style field`);
  }
  return Object.keys(style).length ? style : undefined;
}

/** The model's floor for a planned box: a frame is a section, not a line. */
export function minimumFor(type) {
  return type === "frame"
    ? { width: 160, height: 120 }
    : { width: PLAN_LIMITS.minSize, height: PLAN_LIMITS.minHeight };
}

export function countsOf(objects, connectors, placements = []) {
  const byType = {};
  for (const object of objects) byType[object.type] = (byType[object.type] ?? 0) + 1;
  return {
    objects: objects.length,
    connectors: connectors.length,
    placements: placements.length,
    actions: objects.length + connectors.length + placements.length,
    byType,
  };
}
