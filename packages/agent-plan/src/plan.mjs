import {
  ARROW_SET,
  CONNECTABLE_TYPE_SET,
  PLAN_LIMITS,
  PLANNED_TYPE_SET,
  PlanError,
  ROUTING_SET,
  SHAPE_KIND_SET,
  cleanStyle,
  countsOf,
  finiteIn,
  isRecord,
  minimumFor,
  textField,
} from "./limits.mjs";
import { estimatePlan } from "./estimate.mjs";
import { buildStructurePlan, planBounds } from "./layout.mjs";

const OBJECT_KEYS = new Set([
  "tempId",
  "type",
  "x",
  "y",
  "width",
  "height",
  "parentRef",
  "title",
  "text",
  "shapeKind",
  "style",
]);
const PLACEMENT_KEYS = new Set(["id", "x", "y", "parentRef"]);
const CONNECTOR_KEYS = new Set(["tempId", "from", "to", "arrow", "routing", "style"]);
const CONNECTOR_STYLE_FIELDS = new Set(["strokeColor", "strokeStyle", "strokeWidth"]);
const OPERATIONS = new Set([
  "create_widgets",
  "create_connector",
  "create_structure",
  "place_widgets",
]);
const TEMP_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function assertKeys(value, allowed, code, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PlanError(code, `${label} has an unknown field "${key}"`);
    }
  }
}

function cleanOrigin(origin) {
  if (origin === undefined || origin === null) return { x: 0, y: 0 };
  if (!isRecord(origin)) throw new PlanError("BAD_ORIGIN", "origin must be {x, y}");
  return {
    x: finiteIn(origin.x, -PLAN_LIMITS.coordinate, PLAN_LIMITS.coordinate, "BAD_ORIGIN", "origin.x is out of bounds"),
    y: finiteIn(origin.y, -PLAN_LIMITS.coordinate, PLAN_LIMITS.coordinate, "BAD_ORIGIN", "origin.y is out of bounds"),
  };
}

function cleanRef(value, field, code) {
  if (typeof value !== "string") throw new PlanError(code, `${field} must be a string`);
  const ref = value.trim();
  if (!ref) throw new PlanError(code, `${field} must not be empty`);
  if (ref.length > PLAN_LIMITS.idLength) {
    throw new PlanError(code, `${field} is longer than ${PLAN_LIMITS.idLength} characters`);
  }
  return ref;
}

function cleanObject(value, index) {
  if (!isRecord(value)) throw new PlanError("BAD_WIDGET", `objects[${index}] must be an object`);
  assertKeys(value, OBJECT_KEYS, "BAD_WIDGET", `objects[${index}]`);

  const tempId = cleanRef(value.tempId, `objects[${index}].tempId`, "BAD_TEMP_ID");
  if (!TEMP_ID.test(tempId) || tempId.length > PLAN_LIMITS.tempIdLength) {
    throw new PlanError(
      "BAD_TEMP_ID",
      `objects[${index}].tempId must start with a letter and use letters, digits, "_" or "-" (at most ${PLAN_LIMITS.tempIdLength})`,
    );
  }
  const type = String(value.type ?? "");
  if (!PLANNED_TYPE_SET.has(type)) {
    throw new PlanError(
      "BAD_TYPE",
      `objects[${index}].type must be one of ${[...PLANNED_TYPE_SET].join(", ")}`,
    );
  }

  const minimum = minimumFor(type);
  const object = {
    tempId,
    type,
    x: finiteIn(
      value.x,
      -PLAN_LIMITS.coordinate,
      PLAN_LIMITS.coordinate,
      "BAD_COORDINATES",
      `objects[${index}].x is out of bounds`,
    ),
    y: finiteIn(
      value.y,
      -PLAN_LIMITS.coordinate,
      PLAN_LIMITS.coordinate,
      "BAD_COORDINATES",
      `objects[${index}].y is out of bounds`,
    ),
    width: finiteIn(
      value.width,
      minimum.width,
      PLAN_LIMITS.maxSize,
      "BAD_SIZE",
      `objects[${index}].width must be from ${minimum.width} to ${PLAN_LIMITS.maxSize}`,
    ),
    height: finiteIn(
      value.height,
      minimum.height,
      PLAN_LIMITS.maxSize,
      "BAD_SIZE",
      `objects[${index}].height must be from ${minimum.height} to ${PLAN_LIMITS.maxSize}`,
    ),
  };

  const title = textField(value.title, {
    code: "BAD_WIDGET",
    field: `objects[${index}].title`,
    max: PLAN_LIMITS.titleLength,
  });
  if (title !== undefined) object.title = title;
  const text = textField(value.text, {
    code: "BAD_WIDGET",
    field: `objects[${index}].text`,
    max: PLAN_LIMITS.textLength,
  });
  if (text !== undefined) object.text = text;
  if (type === "frame" && object.text !== undefined) {
    throw new PlanError("BAD_WIDGET", `objects[${index}] is a frame and carries a title, not text`);
  }

  if (value.parentRef !== undefined) {
    if (type === "frame") {
      throw new PlanError("PARENT_NOT_ALLOWED", `objects[${index}] is a frame; frames do not nest`);
    }
    object.parentRef = cleanRef(value.parentRef, `objects[${index}].parentRef`, "BAD_PARENT");
  }
  if (value.shapeKind !== undefined) {
    if (type !== "shape") {
      throw new PlanError("BAD_WIDGET", `objects[${index}].shapeKind is only allowed on a shape`);
    }
    if (!SHAPE_KIND_SET.has(value.shapeKind)) {
      throw new PlanError(
        "BAD_WIDGET",
        `objects[${index}].shapeKind must be one of ${[...SHAPE_KIND_SET].join(", ")}`,
      );
    }
    object.shapeKind = value.shapeKind;
  }
  const style = cleanStyle(value.style, { code: "BAD_STYLE" });
  if (style !== undefined) object.style = style;
  return object;
}

function cleanConnector(value, index, { operationLevel = false } = {}) {
  const label = operationLevel ? `operations[${index}]` : `connectors[${index}]`;
  const code = "BAD_CONNECTOR";
  if (!isRecord(value)) throw new PlanError(code, `${label} must be an object`);
  // The operation carries `op`; a connector inside a plan does not.
  assertKeys(
    value,
    operationLevel ? new Set([...CONNECTOR_KEYS, "op"]) : CONNECTOR_KEYS,
    code,
    label,
  );

  const connector = {
    from: cleanRef(value.from, `${label}.from`, code),
    to: cleanRef(value.to, `${label}.to`, code),
  };
  if (value.tempId !== undefined) {
    const tempId = cleanRef(value.tempId, `${label}.tempId`, "BAD_TEMP_ID");
    if (!TEMP_ID.test(tempId) || tempId.length > PLAN_LIMITS.tempIdLength) {
      throw new PlanError(
        "BAD_TEMP_ID",
        `${label}.tempId must start with a letter, use letters, digits, "_" or "-", and be at most ${PLAN_LIMITS.tempIdLength} characters`,
      );
    }
    connector.tempId = tempId;
  }
  if (value.arrow !== undefined) {
    if (!ARROW_SET.has(value.arrow)) {
      throw new PlanError(code, `${label}.arrow must be one of ${[...ARROW_SET].join(", ")}`);
    }
    connector.arrow = value.arrow;
  }
  if (value.routing !== undefined) {
    if (!ROUTING_SET.has(value.routing)) {
      throw new PlanError(code, `${label}.routing must be one of ${[...ROUTING_SET].join(", ")}`);
    }
    connector.routing = value.routing;
  }
  const style = cleanStyle(value.style, { code: "BAD_STYLE", allowed: CONNECTOR_STYLE_FIELDS });
  if (style !== undefined) connector.style = style;
  if (connector.from === connector.to) {
    throw new PlanError("connector_self_loop", "a connector cannot join an object to itself");
  }
  return connector;
}

function cleanPlacement(value, index) {
  const label = `placements[${index}]`;
  const code = "BAD_PLACEMENT";
  if (!isRecord(value)) throw new PlanError(code, `${label} must be an object`);
  assertKeys(value, PLACEMENT_KEYS, code, label);
  const placement = {
    id: cleanRef(value.id, `${label}.id`, code),
    x: finiteIn(
      value.x,
      -PLAN_LIMITS.coordinate,
      PLAN_LIMITS.coordinate,
      "BAD_COORDINATES",
      `${label}.x is out of bounds`,
    ),
    y: finiteIn(
      value.y,
      -PLAN_LIMITS.coordinate,
      PLAN_LIMITS.coordinate,
      "BAD_COORDINATES",
      `${label}.y is out of bounds`,
    ),
  };
  if (value.parentRef !== undefined) {
    placement.parentRef = cleanRef(value.parentRef, `${label}.parentRef`, "BAD_PARENT");
    if (placement.parentRef === placement.id) {
      throw new PlanError("PARENT_CYCLE", `${label} is its own parent`);
    }
  }
  return placement;
}

function pairKey(from, to) {
  return from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
}

/**
 * Validate and normalize a plan against optional board facts.
 *
 * `existingWidgets` and `existingConnectors` are supplied by the server, which knows
 * the live document. Without them (the client validating a plan before apply), a ref
 * that is not a tempId is treated as an external board id and checked at apply time.
 */
function normalizePlan({
  objects,
  connectors,
  placements = [],
  origin,
  template = null,
  warnings = [],
  existingWidgets = [],
  existingConnectors = [],
  allowedIds = null,
  allowUnknownRefs = false,
}) {
  if (objects.length + connectors.length + placements.length === 0) {
    throw new PlanError(
      "EMPTY_PLAN",
      "a plan needs at least one object, connector or placement",
    );
  }
  if (objects.length > PLAN_LIMITS.objects) {
    throw new PlanError(
      "PLAN_TOO_LARGE",
      `the plan creates ${objects.length} objects; one plan allows ${PLAN_LIMITS.objects}`,
    );
  }
  if (placements.length > PLAN_LIMITS.objects) {
    throw new PlanError(
      "PLAN_TOO_LARGE",
      `the plan places ${placements.length} objects; one plan allows ${PLAN_LIMITS.objects}`,
    );
  }
  if (connectors.length > PLAN_LIMITS.connectors) {
    throw new PlanError(
      "TOO_MANY_CONNECTORS",
      `the plan creates ${connectors.length} connectors; one plan allows ${PLAN_LIMITS.connectors}`,
    );
  }

  const existing = new Map();
  for (const widget of existingWidgets) {
    const id = String(widget?.id ?? "");
    if (!id) continue;
    existing.set(id, {
      type: String(widget?.type ?? ""),
      locked: widget?.locked === true,
      parentId: widget?.parentId ? String(widget.parentId) : null,
      x: Number.isFinite(Number(widget?.x)) ? Number(widget.x) : null,
      y: Number.isFinite(Number(widget?.y)) ? Number(widget.y) : null,
      width: Number.isFinite(Number(widget?.width)) ? Number(widget.width) : null,
      height: Number.isFinite(Number(widget?.height)) ? Number(widget.height) : null,
    });
  }
  const allowed = allowedIds ? new Set([...allowedIds].map(String)) : null;

  const byTemp = new Map();
  for (const object of objects) {
    if (byTemp.has(object.tempId)) {
      throw new PlanError("DUPLICATE_TEMP_ID", `tempId "${object.tempId}" is used twice`);
    }
    if (existing.has(object.tempId)) {
      throw new PlanError(
        "TEMP_ID_TAKEN",
        `tempId "${object.tempId}" already names an object on this board`,
      );
    }
    byTemp.set(object.tempId, object);
  }

  const resolve = (ref) => {
    const planned = byTemp.get(ref);
    if (planned) return { type: planned.type, locked: false, planned: true };
    const found = existing.get(ref);
    if (found) return { type: found.type, locked: found.locked, planned: false };
    return null;
  };

  for (const object of objects) {
    if (!object.parentRef) continue;
    if (object.parentRef === object.tempId) {
      throw new PlanError("PARENT_CYCLE", `object "${object.tempId}" is its own parent`);
    }
    const parent = resolve(object.parentRef);
    if (!parent) {
      // The client validates a plan without the board: a ref it cannot resolve is
      // assumed to be an existing object and is checked before the transaction.
      if (allowUnknownRefs) continue;
      throw new PlanError("PARENT_NOT_FOUND", `parent "${object.parentRef}" does not exist`);
    }
    if (parent.type !== "frame") {
      throw new PlanError("PARENT_NOT_FRAME", `parent "${object.parentRef}" is not a frame`);
    }
    if (parent.locked) {
      throw new PlanError("PARENT_LOCKED", `parent "${object.parentRef}" is locked`);
    }
  }

  // Cycles are only possible between planned objects; an existing parent cannot point
  // back into this plan. The walk also covers the malformed forward-reference case.
  const visiting = new Set();
  const done = new Set();
  const visit = (tempId) => {
    if (done.has(tempId)) return;
    if (visiting.has(tempId)) {
      throw new PlanError("PARENT_CYCLE", `parent chain through "${tempId}" is a cycle`);
    }
    visiting.add(tempId);
    const object = byTemp.get(tempId);
    const parentRef = object?.parentRef;
    if (parentRef && byTemp.has(parentRef)) visit(parentRef);
    visiting.delete(tempId);
    done.add(tempId);
  };
  for (const object of objects) visit(object.tempId);

  /* ------------------------------------------------------------ placements --- */

  const seenPlacements = new Set();
  const placementBoxes = [];
  const keptPlacements = [];
  const placementWarnings = [];
  for (const [index, placement] of placements.entries()) {
    if (seenPlacements.has(placement.id)) {
      throw new PlanError(
        "DUPLICATE_PLACEMENT",
        `object "${placement.id}" is placed twice; a tidy plan has one destination per object`,
      );
    }
    seenPlacements.add(placement.id);
    if (byTemp.has(placement.id)) {
      throw new PlanError(
        "PLACE_PLANNED",
        `object "${placement.id}" is created by this plan; create it at its destination instead`,
      );
    }
    if (allowed && !allowed.has(placement.id)) {
      throw new PlanError(
        "OBJECT_NOT_ALLOWED",
        `object "${placement.id}" is not in the selection this plan was built from`,
      );
    }
    const found = existing.get(placement.id);
    if (!found) {
      // Without board facts the apply preflight checks every id against the live
      // document before the transaction.
      if (allowUnknownRefs) {
        keptPlacements.push(placement);
        continue;
      }
      throw new PlanError(
        "OBJECT_NOT_FOUND",
        `object "${placement.id}" does not exist on this board`,
      );
    }
    if (found.locked) {
      // A lock is a decision (ADR-040): the object stays where it is and the report
      // says so, instead of the whole tidy being refused for one untouched note.
      placementWarnings.push({
        code: "TIDY_LOCKED_SKIPPED",
        message: `"${placement.id}" is locked and was not moved`,
        tempId: placement.id,
      });
      continue;
    }
    if (found.type === "frame") {
      throw new PlanError(
        "FRAME_NOT_PLACED",
        `"${placement.id}" is a frame; tidy moves its contents, not the frame`,
      );
    }
    if (found.type === "connector") {
      throw new PlanError(
        "CONNECTOR_NOT_PLACED",
        `"${placement.id}" is a connector; a tidy plan never bends a line`,
      );
    }
    if (found.type === "card" && found.parentId) {
      throw new PlanError(
        "CARD_NOT_PLACED",
        `"${placement.id}" lives in a kanban column; its position belongs to the matrix`,
      );
    }

    if (placement.parentRef) {
      const parent = resolve(placement.parentRef);
      if (!parent) {
        if (!allowUnknownRefs) {
          throw new PlanError(
            "PARENT_NOT_FOUND",
            `parent "${placement.parentRef}" does not exist`,
          );
        }
      } else {
        if (parent.type !== "frame") {
          throw new PlanError(
            "PARENT_NOT_FRAME",
            `parent "${placement.parentRef}" is not a frame`,
          );
        }
        if (parent.locked) {
          throw new PlanError("PARENT_LOCKED", `parent "${placement.parentRef}" is locked`);
        }
      }
    }

    keptPlacements.push(placement);
    if (found.width !== null && found.height !== null) {
      placementBoxes.push({
        x: placement.x,
        y: placement.y,
        width: found.width,
        height: found.height,
      });
    }
  }

  const seenPairs = new Set();
  for (const connector of existingConnectors) {
    const from = String(connector?.from ?? "");
    const to = String(connector?.to ?? "");
    if (from && to) seenPairs.add(pairKey(from, to));
  }
  const connectorIds = new Set();
  for (const [index, connector] of connectors.entries()) {
    if (connector.from === connector.to) {
      throw new PlanError("connector_self_loop", "a connector cannot join an object to itself");
    }
    const from = resolve(connector.from);
    const to = resolve(connector.to);
    if (!from || !to) {
      // The client has no board: an unresolved ref is an existing object id and is
      // checked by the apply preflight against the live document.
      if (!allowUnknownRefs) {
        throw new PlanError(
          "CONNECTOR_TARGET_MISSING",
          `connector ${index + 1} refers to an object that does not exist`,
        );
      }
    } else {
      if (!CONNECTABLE_TYPE_SET.has(from.type) || !CONNECTABLE_TYPE_SET.has(to.type)) {
        throw new PlanError(
          "CONNECTOR_TARGET_INVALID",
          `connector ${index + 1} must join connectable objects`,
        );
      }
      if (from.locked || to.locked) {
        throw new PlanError("CONNECTOR_TARGET_LOCKED", `connector ${index + 1} joins a locked object`);
      }
    }
    const key = pairKey(connector.from, connector.to);
    if (seenPairs.has(key)) {
      throw new PlanError("CONNECTOR_EXISTS", "these objects already have a connector");
    }
    seenPairs.add(key);

    if (!connector.tempId) connector.tempId = `tmp_conn_${index + 1}`;
    if (connectorIds.has(connector.tempId) || byTemp.has(connector.tempId)) {
      throw new PlanError("DUPLICATE_TEMP_ID", `tempId "${connector.tempId}" is used twice`);
    }
    if (existing.has(connector.tempId)) {
      throw new PlanError("TEMP_ID_TAKEN", `tempId "${connector.tempId}" already names an object`);
    }
    connectorIds.add(connector.tempId);
  }

  const allBounds = [...objects, ...placementBoxes];
  const core = {
    version: 1,
    template,
    origin,
    objects,
    connectors,
    placements: keptPlacements,
    counts: countsOf(objects, connectors, keptPlacements),
    bounds: planBounds(allBounds),
    warnings: [...warnings, ...placementWarnings],
  };
  const estimate = estimatePlan(core);
  return {
    ...core,
    counts: {
      objects: estimate.objects,
      connectors: estimate.connectors,
      placements: estimate.placements,
      actions: estimate.actions,
      byType: estimate.byType,
    },
    bounds: estimate.bounds,
    warnings: estimate.warnings,
  };
}

/**
 * Operations → one plan (ADR-142, ADR-143).
 *
 * `context.existingWidgets` (`{id, type, locked, x?, y?, width?, height?, parentId?}`)
 * and `context.existingConnectors` (`{from, to}`) are the server's view of the live
 * board; omitting them validates the plan's internal consistency only.
 * `context.allowedIds` is the tidy selection: a placement outside it is a refusal.
 */
export function planFromOperations(operations, context = {}) {
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > PLAN_LIMITS.operations
  ) {
    throw new PlanError(
      "BAD_OPERATIONS",
      `a plan needs 1 to ${PLAN_LIMITS.operations} operations`,
    );
  }
  const origin = cleanOrigin(context.origin);
  const objects = [];
  const connectors = [];
  const placements = [];
  const warnings = [];
  let template = null;

  for (const [index, operation] of operations.entries()) {
    if (!isRecord(operation) || !OPERATIONS.has(operation.op)) {
      throw new PlanError(
        "BAD_OPERATION",
        `operations[${index}] must be create_widgets, create_connector, create_structure or place_widgets`,
      );
    }
    if (operation.op === "create_widgets") {
      assertKeys(operation, new Set(["op", "objects"]), "BAD_OPERATION", `operations[${index}]`);
      if (!Array.isArray(operation.objects) || operation.objects.length === 0) {
        throw new PlanError("BAD_OPERATIONS", `operations[${index}] needs a non-empty objects array`);
      }
      for (const [objectIndex, value] of operation.objects.entries()) {
        objects.push(cleanObject(value, objectIndex));
      }
      continue;
    }
    if (operation.op === "place_widgets") {
      if (context.allowPlacements === false) {
        // A skill that only creates objects cannot acquire a moving operation by
        // asking for one: the brief contract is create-only (ADR-142, ADR-143).
        throw new PlanError(
          "OPERATION_NOT_ALLOWED",
          `operations[${index}] may not move objects; this skill only creates them`,
        );
      }
      assertKeys(operation, new Set(["op", "items"]), "BAD_OPERATION", `operations[${index}]`);
      if (!Array.isArray(operation.items) || operation.items.length === 0) {
        throw new PlanError("BAD_OPERATIONS", `operations[${index}] needs a non-empty items array`);
      }
      for (const [itemIndex, value] of operation.items.entries()) {
        placements.push(cleanPlacement(value, itemIndex));
      }
      continue;
    }
    if (operation.op === "create_connector") {
      assertKeys(
        operation,
        new Set(["op", "tempId", "from", "to", "arrow", "routing", "style"]),
        "BAD_OPERATION",
        `operations[${index}]`,
      );
      connectors.push(cleanConnector(operation, index, { operationLevel: true }));
      continue;
    }

    assertKeys(
      operation,
      new Set(["op", "template", "title", "columns", "swimlanes"]),
      "BAD_OPERATION",
      `operations[${index}]`,
    );
    const structure = buildStructurePlan(
      operation.template,
      {
        ...(operation.title !== undefined ? { title: operation.title } : {}),
        columns: operation.columns,
        ...(operation.swimlanes !== undefined ? { swimlanes: operation.swimlanes } : {}),
      },
      origin,
    );
    objects.push(...structure.objects);
    warnings.push(...structure.warnings);
    template = operation.template;
  }

  return normalizePlan({
    objects,
    connectors,
    placements,
    origin,
    template,
    warnings,
    existingWidgets: Array.isArray(context.existingWidgets) ? context.existingWidgets : [],
    existingConnectors: Array.isArray(context.existingConnectors) ? context.existingConnectors : [],
    allowedIds: Array.isArray(context.allowedIds) ? context.allowedIds : null,
  });
}

/**
 * Validate a ready plan (the client calls this before writing).
 *
 * Refs that are not tempIds are assumed to be board objects and are checked by the
 * caller against the live document before the transaction starts. Counts and bounds
 * are recomputed, so a plan cannot lie about what it contains.
 */
export function validatePlan(plan, context = {}) {
  if (!isRecord(plan)) throw new PlanError("BAD_PLAN", "a plan must be an object");
  if (plan.version !== 1) throw new PlanError("BAD_PLAN", "a plan must have version 1");
  if (!Array.isArray(plan.objects)) throw new PlanError("BAD_PLAN", "plan.objects must be an array");
  if (!Array.isArray(plan.connectors)) {
    throw new PlanError("BAD_PLAN", "plan.connectors must be an array");
  }
  if (plan.placements !== undefined && !Array.isArray(plan.placements)) {
    throw new PlanError("BAD_PLAN", "plan.placements must be an array");
  }
  const objects = plan.objects.map((value, index) => cleanObject(value, index));
  const connectors = plan.connectors.map((value, index) => cleanConnector(value, index));
  const placements = (plan.placements ?? []).map((value, index) =>
    cleanPlacement(value, index),
  );
  return normalizePlan({
    objects,
    connectors,
    placements,
    origin: cleanOrigin(plan.origin),
    template: typeof plan.template === "string" ? plan.template : null,
    warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
    existingWidgets: Array.isArray(context.existingWidgets) ? context.existingWidgets : [],
    existingConnectors: Array.isArray(context.existingConnectors)
      ? context.existingConnectors
      : [],
    allowedIds: Array.isArray(context.allowedIds) ? context.allowedIds : null,
    allowUnknownRefs: true,
  });
}

