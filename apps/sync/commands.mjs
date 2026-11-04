/**
 * The server-side command registry (ADR-092).
 *
 * A command is a named, validated change to a board document. It is the one path an
 * integration or an automation uses to write: capability check, input validation,
 * stale check, Yjs transaction, audit and idempotency all surround the same function.
 * The interactive UI still writes through Yjs directly — that is what keeps offline
 * editing honest — but anything acting for a person *outside* their open tab goes
 * through here.
 */
import { createHash, randomUUID } from "node:crypto";
import { Y } from "./y.mjs";

export class CommandError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TEXT_TYPES = new Set(["sticky_note", "text", "shape", "card", "connector"]);
const CREATABLE = new Set(["sticky_note", "text", "shape", "frame"]);
const CONNECTABLE = new Set(["sticky_note", "text", "shape", "image", "stamp", "card"]);
const CONTAINERS = new Set(["frame", "kanban", "group"]);
/** The object name is a short label, not a field of text (ADR-165). */
const MAX_NAME = 120;

/** Stable document version: any Yjs update changes the state vector. */
export function docVersion(ydoc) {
  return createHash("sha256")
    .update(Buffer.from(Y.encodeStateVector(ydoc)))
    .digest("hex")
    .slice(0, 16);
}

function widgets(ydoc) {
  return ydoc.getMap("widgets");
}

function texts(ydoc) {
  return ydoc.getMap("texts");
}

function number(value, name, { min = -1_000_000, max = 1_000_000 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new CommandError("BAD_INPUT", `${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function text(value, name, max = 20_000) {
  if (typeof value !== "string") throw new CommandError("BAD_INPUT", `${name} must be a string`);
  if (value.length > max) throw new CommandError("BAD_INPUT", `${name} is longer than ${max}`);
  return value;
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandError("BAD_INPUT", `${name} must be an object`);
  }
  return value;
}

/** May this caller release the lock (ADR-107)? A legacy lock has no author. */
function mayUnlock(widget, actor, capabilities) {
  if (!widget.lockedBy) return true;
  if ((capabilities ?? []).includes("board.manage")) return true;
  return Boolean(actor?.id) && widget.lockedBy === actor.id;
}

function existing(ydoc, id) {
  const widget = widgets(ydoc).get(id);
  if (!widget) throw new CommandError("OBJECT_NOT_FOUND", `no object ${id}`, 404);
  return widget;
}

function replaceText(ydoc, id, value) {
  const store = texts(ydoc);
  const current = store.get(id);
  if (current && typeof current.delete === "function") {
    current.delete(0, current.length);
    current.insert(0, value);
    return;
  }
  const created = new Y.Text();
  created.insert(0, value);
  store.set(id, created);
}

function seedText(ydoc, widget, value) {
  if (!TEXT_TYPES.has(widget.type) || !value) return;
  const created = new Y.Text();
  created.insert(0, value);
  texts(ydoc).set(widget.id, created);
}

/** Deterministic id when a key is present, so a retry cannot create a second object. */
export function commandObjectId({ boardId, actorId, key, prefix }) {
  if (!key) return `${prefix}_${randomUUID().slice(0, 12)}`;
  const digest = createHash("sha256")
    .update(`${boardId}:${actorId}:${key}`)
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${digest}`;
}

function sanitizeStyle(style) {
  const allowed = ["fillColor", "textColor", "strokeColor", "strokeWidth", "fontSize", "fontFamily"];
  const out = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    if (!allowed.includes(key)) continue;
    if (typeof value !== "string" && typeof value !== "number") {
      throw new CommandError("BAD_INPUT", `style.${key} must be a string or a number`);
    }
    out[key] = value;
  }
  return out;
}

function waypointList(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new CommandError("BAD_INPUT", "waypoints must be an array of at most 32 points");
  }
  return value.map((point, index) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new CommandError("BAD_INPUT", "every waypoint needs finite x and y");
    }
    return {
      id: String(point?.id ?? `wp_${index}`),
      x,
      y,
      rigid: point?.rigid !== false,
    };
  });
}

export const COMMANDS = {
  "board.item.create": {
    capabilities: ["board.edit"],
    validate(input) {
      const data = object(input, "input");
      // The id is assigned by the command runner (or by a change set's forced id); a
      // caller-supplied id would overwrite an existing object, including a locked one.
      if (data.id !== undefined) {
        throw new CommandError("BAD_INPUT", "the server assigns the object id");
      }
      if (!CREATABLE.has(data.type)) {
        throw new CommandError("BAD_INPUT", `type must be one of ${[...CREATABLE].join(", ")}`);
      }
      number(data.x, "x");
      number(data.y, "y");
      if (data.width !== undefined) number(data.width, "width", { min: 1, max: 20_000 });
      if (data.height !== undefined) number(data.height, "height", { min: 1, max: 20_000 });
      if (data.content !== undefined) text(data.content, "content");
      if (data.title !== undefined) text(data.title, "title", 2_000);
      if (data.name !== undefined) text(data.name, "name", MAX_NAME);
      if (data.style !== undefined) sanitizeStyle(data.style);
      // An explicit container is for a template or a script that already knows where
      // the object belongs; a person's drop goes through the centre rule (ADR-110).
      if (data.parentId !== undefined) text(data.parentId, "parentId", 200);
      return data;
    },
    apply({ ydoc, input, actor, objectId }) {
      if (widgets(ydoc).has(objectId)) {
        throw new CommandError("OBJECT_EXISTS", `object ${objectId} already exists`, 409);
      }
      let parentId = null;
      if (input.parentId) {
        const parent = widgets(ydoc).get(input.parentId);
        if (!parent || parent.type !== "frame" || parent.locked) {
          throw new CommandError(
            "BAD_INPUT",
            "parentId must name an unlocked frame on this board",
          );
        }
        parentId = input.parentId;
      }
      const widget = {
        id: objectId,
        type: input.type,
        parentId,
        x: input.x,
        y: input.y,
        width: input.width ?? (input.type === "sticky_note" ? 160 : 220),
        height: input.height ?? (input.type === "sticky_note" ? 180 : 110),
        ...(input.title ? { title: input.title } : {}),
        ...(input.content ? { content: input.content } : {}),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.style ? { style: sanitizeStyle(input.style) } : {}),
        createdBy: actor.name ?? actor.id,
        createdAt: Date.now(),
      };
      ydoc.transact(() => {
        widgets(ydoc).set(widget.id, widget);
        seedText(ydoc, widget, input.content ?? input.title);
      });
      return { id: widget.id, type: widget.type };
    },
    // Events are ids and counts only: the text lives in the document, not in the
    // event (ADR-094). The type is derived from the result the command returned, so
    // the two cannot drift.
    events({ result }) {
      return [
        {
          type: "board.item.created",
          subject: result.id,
          payload: { objectType: result.type },
        },
      ];
    },
  },

  "board.item.update": {
    capabilities: ["board.edit"],
    validate(input) {
      const data = object(input, "input");
      text(data.id, "id", 200);
      const patch = object(data.patch, "patch");
      const allowed = ["x", "y", "width", "height", "title", "content", "name", "style", "locked"];
      for (const key of Object.keys(patch)) {
        if (!allowed.includes(key)) throw new CommandError("BAD_INPUT", `patch.${key} is not allowed`);
      }
      if (patch.x !== undefined) number(patch.x, "x");
      if (patch.y !== undefined) number(patch.y, "y");
      if (patch.width !== undefined) number(patch.width, "width", { min: 1, max: 20_000 });
      if (patch.height !== undefined) number(patch.height, "height", { min: 1, max: 20_000 });
      if (patch.title !== undefined) text(patch.title, "title", 2_000);
      if (patch.content !== undefined) text(patch.content, "content");
      if (patch.name !== undefined) {
        text(patch.name, "name", MAX_NAME);
        patch.name = patch.name.trim();
      }
      if (patch.style !== undefined) sanitizeStyle(patch.style);
      if (patch.locked !== undefined && typeof patch.locked !== "boolean") {
        throw new CommandError("BAD_INPUT", "locked must be a boolean");
      }
      return data;
    },
    apply({ ydoc, input, actor, capabilities }) {
      const current = existing(ydoc, input.id);
      const patch = { ...input.patch };
      if (current.locked) {
        // A locked object refuses everything except its own release, and the release
        // belongs to the author or a board manager (ADR-107).
        if (patch.locked !== false) {
          throw new CommandError("OBJECT_LOCKED", "the object is locked", 409);
        }
        if (!mayUnlock(current, actor, capabilities)) {
          const by = current.lockedByName || current.lockedBy;
          throw new CommandError("LOCKED_BY_OTHER", `only ${by} or a board manager can unlock it`, 409);
        }
      }
      if (patch.locked === true) {
        patch.lockedBy = actor?.id ?? null;
        patch.lockedByName = actor?.name ?? "";
        patch.lockedAt = Date.now();
      } else if (patch.locked === false) {
        delete patch.lockedBy;
        delete patch.lockedByName;
        delete patch.lockedAt;
      }
      if (patch.style) patch.style = { ...(current.style ?? {}), ...sanitizeStyle(patch.style) };
      ydoc.transact(() => {
        const next = { ...current, ...patch };
        if (patch.locked === false) {
          delete next.locked;
          delete next.lockedBy;
          delete next.lockedByName;
          delete next.lockedAt;
        }
        // An empty name clears the metadata instead of storing a blank label.
        if (patch.name === "") delete next.name;
        widgets(ydoc).set(input.id, next);
        if (patch.content !== undefined) replaceText(ydoc, input.id, patch.content);
      });
      return { id: input.id, changed: Object.keys(patch) };
    },
  },

  "board.item.delete": {
    capabilities: ["board.edit"],
    validate(input) {
      const data = object(input, "input");
      text(data.id, "id", 200);
      return data;
    },
    apply({ ydoc, input }) {
      const widget = existing(ydoc, input.id);
      if (widget.locked) {
        throw new CommandError(
          "OBJECT_LOCKED",
          "a locked object must be unlocked before it can be deleted",
          409,
        );
      }
      const removedConnectors = [];
      ydoc.transact(() => {
        for (const [id, candidate] of widgets(ydoc)) {
          if (candidate.type !== "connector") continue;
          if (candidate.start?.item === input.id || candidate.end?.item === input.id) {
            widgets(ydoc).delete(id);
            texts(ydoc).delete(id);
            removedConnectors.push(id);
          }
        }
        if (widget.type === "kanban") {
          for (const [id, candidate] of widgets(ydoc)) {
            if (candidate.parentId !== input.id) continue;
            widgets(ydoc).delete(id);
            texts(ydoc).delete(id);
          }
        }
        widgets(ydoc).delete(input.id);
        texts(ydoc).delete(input.id);
      });
      return { id: input.id, connectors: removedConnectors.length };
    },
  },

  "board.text.set": {
    capabilities: ["board.edit"],
    validate(input) {
      const data = object(input, "input");
      text(data.id, "id", 200);
      text(data.text, "text");
      return data;
    },
    apply({ ydoc, input }) {
      const widget = existing(ydoc, input.id);
      if (!TEXT_TYPES.has(widget.type)) {
        throw new CommandError("NOT_TEXT", `${widget.type} does not hold text`);
      }
      ydoc.transact(() => {
        replaceText(ydoc, input.id, input.text);
        widgets(ydoc).set(input.id, {
          ...widget,
          ...(widget.type === "card" ? { title: input.text } : { content: input.text }),
        });
      });
      return { id: input.id, length: input.text.length };
    },
  },

  "board.connector.create": {
    capabilities: ["board.edit"],
    validate(input) {
      const data = object(input, "input");
      text(data.from, "from", 200);
      text(data.to, "to", 200);
      if (data.from === data.to) {
        throw new CommandError("SELF_LOOP", "a connector cannot join an object to itself");
      }
      if (data.routing !== undefined && !["straight", "elbow", "curved"].includes(data.routing)) {
        throw new CommandError("BAD_INPUT", "routing must be straight, elbow or curved");
      }
      if (data.arrow !== undefined && !["none", "end", "both", "start"].includes(data.arrow)) {
        throw new CommandError("BAD_INPUT", "arrow must be none, end, both or start");
      }
      if (data.id !== undefined) text(data.id, "id", 200);
      if (data.waypoints !== undefined) waypointList(data.waypoints);
      if (data.style !== undefined) sanitizeStyle(data.style);
      return data;
    },
    apply({ ydoc, input, objectId, actor, createdBy, agent }) {
      if (widgets(ydoc).has(objectId)) {
        throw new CommandError("OBJECT_EXISTS", `object ${objectId} already exists`, 409);
      }
      // One line between a pair, the same rule change sets enforce.
      for (const candidate of widgets(ydoc).values()) {
        if (candidate.type !== "connector") continue;
        const ends = [candidate.start?.item, candidate.end?.item];
        if (ends.includes(input.from) && ends.includes(input.to)) {
          throw new CommandError("CONNECTOR_EXISTS", "these objects already have a connector", 409);
        }
      }
      const from = existing(ydoc, input.from);
      const to = existing(ydoc, input.to);
      for (const widget of [from, to]) {
        if (!CONNECTABLE.has(widget.type) || CONTAINERS.has(widget.type)) {
          throw new CommandError("NOT_CONNECTABLE", `${widget.type} cannot be a connector endpoint`);
        }
      }
      const connector = {
        id: objectId,
        type: "connector",
        parentId: null,
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        width: Math.abs(from.x - to.x),
        height: Math.abs(from.y - to.y),
        start: { item: from.id },
        end: { item: to.id },
        routing: input.routing ?? "elbow",
        arrow: input.arrow ?? "end",
        ...(input.waypoints !== undefined ? { waypoints: waypointList(input.waypoints) } : {}),
        ...(input.style ? { style: sanitizeStyle(input.style) } : {}),
        createdBy: createdBy ?? actor.name ?? actor.id,
        createdAt: Date.now(),
        ...(agent ? { agent } : {}),
      };
      ydoc.transact(() => {
        widgets(ydoc).set(connector.id, connector);
      });
      return { id: connector.id, from: from.id, to: to.id };
    },
    // Every path that creates a connector — an HTTP command, a change set, MCP — emits the
    // same event, because the declaration lives here (ADR-097).
    events({ result }) {
      return [
        {
          type: "board.connector.created",
          subject: result.id,
          payload: { from: result.from, to: result.to },
        },
      ];
    },
  },

  "board.connector.update": {
    capabilities: ["board.edit"],
    validate(input) {
      const data = object(input, "input");
      text(data.id, "id", 200);
      if (data.routing !== undefined && !["straight", "elbow", "curved"].includes(data.routing)) {
        throw new CommandError("BAD_INPUT", "routing must be straight, elbow or curved");
      }
      if (data.waypoints !== undefined) waypointList(data.waypoints);
      return data;
    },
    apply({ ydoc, input }) {
      const widget = existing(ydoc, input.id);
      if (widget.type !== "connector") {
        throw new CommandError("NOT_CONNECTOR", `${widget.type} is not a connector`);
      }
      const next = {
        ...widget,
        routing: input.routing ?? widget.routing ?? "elbow",
        ...(input.waypoints !== undefined ? { waypoints: waypointList(input.waypoints) } : {}),
      };
      delete next.connectorShape;
      delete next.bend;
      delete next.elbowFlip;
      delete next.curve;
      ydoc.transact(() => {
        widgets(ydoc).set(widget.id, next);
      });
      return { id: widget.id, routing: next.routing };
    },
    events({ result }) {
      return [
        {
          type: "board.connector.updated",
          subject: result.id,
          payload: { routing: result.routing },
        },
      ];
    },
  },
};

export function commandNames() {
  return Object.keys(COMMANDS);
}

/**
 * Run one command against a document.
 *
 * The document is mutated in exactly one Yjs transaction, so peers see a complete
 * change. `ifVersion` is optional: an automation that read the board earlier can ask
 * for a stale check instead of overwriting somebody else's edit.
 */
export function runCommand({
  ydoc,
  name,
  input,
  actor,
  ifVersion,
  idempotencyKey = null,
  boardId = "",
  objectId: forcedId = null,
  createdBy = null,
  agent = null,
  capabilities = [],
}) {
  const command = COMMANDS[name];
  if (!command) throw new CommandError("UNKNOWN_COMMAND", `unknown command ${name}`, 404);
  if (ifVersion && ifVersion !== docVersion(ydoc)) {
    throw new CommandError("STALE", "the board changed since this version was read", 409);
  }
  const data = command.validate(input);
  const prefix = name === "board.connector.create" ? "conn" : "item";
  const objectId =
    forcedId ??
    data.id ??
    commandObjectId({
      boardId,
      actorId: actor.id,
      key: idempotencyKey ? `${name}:${idempotencyKey}` : null,
      prefix,
    });
  const result = command.apply({
    ydoc,
    input: data,
    actor,
    objectId,
    createdBy,
    agent,
    capabilities,
  });
  // A command declares its domain events next to its transaction (ADR-094); `runCommand`
  // returns them so the caller can write them in the same database transaction as the
  // idempotency row. No producer, no events.
  const events =
    typeof command.events === "function"
      ? command.events({ result, input: data, actor, boardId })
      : [];
  return { result, version: docVersion(ydoc), events };
}
