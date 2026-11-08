/**
 * Write budgets for the room socket (ADR-173).
 *
 * y-websocket applies every frame it receives. Before this module an editor — or a
 * script holding an editor's cookie — could push 16 MiB frames as fast as the network
 * allowed: each one was applied, broadcast to every peer and appended to the room's log,
 * so one socket could exhaust memory, the event loop, the database and every other
 * organisation on the same service. Three budgets bound that, in the order they are
 * checked:
 *
 * - **Room size.** A room whose document has passed `roomMaxBytes` takes only small
 *   content frames: typing and deletions still work (both encode small), bulk growth
 *   such as a paste does not. A full room can always be cleaned up.
 * - **Socket rate.** A token bucket in bytes per connection; the burst is at least the
 *   largest frame the socket accepts, so a legitimate large paste is never impossible.
 * - **Organisation rate.** The same bucket, shared by every socket of one organisation:
 *   in a shared service one tenant's sockets cannot starve the others (SaaS, ADR-173).
 *
 * A refused frame is dropped and the socket is closed with a code the client
 * understands (4429 rate, 4413 room full). Nothing is lost: the client still holds the
 * edit, and the next handshake's sync step exchanges whatever the server is missing.
 *
 * State is per process, like the sign-in limiter (ADR-069); moving it to PostgreSQL is
 * part of running several instances (review stage 4).
 */
import * as decoding from "lib0/decoding";
import * as Y from "yjs";

export const CLOSE_RATE_LIMITED = 4429;
export const CLOSE_ROOM_FULL = 4413;

const MiB = 1024 * 1024;
const KiB = 1024;

/** Defaults, each overridable from the environment; sizes in bytes, rates per second. */
export const QUOTA_DEFAULTS = Object.freeze({
  socketRate: 256 * KiB,
  socketBurst: 16 * MiB,
  orgRate: 2 * MiB,
  orgBurst: 64 * MiB,
  roomMaxBytes: 64 * MiB,
  smallFrame: 16 * KiB,
  // A byte ceiling does not bound work: 64 MiB of tiny widgets is hundreds of
  // thousands of objects, and painting and hit-testing walk the list (ADR-176).
  maxObjects: 20_000,
});

const ENV = {
  socketRate: "REMO_WS_RATE_BYTES",
  socketBurst: "REMO_WS_BURST_BYTES",
  orgRate: "REMO_ORG_WS_RATE_BYTES",
  orgBurst: "REMO_ORG_WS_BURST_BYTES",
  roomMaxBytes: "REMO_ROOM_MAX_BYTES",
  smallFrame: "REMO_ROOM_FULL_FRAME_BYTES",
  maxObjects: "REMO_ROOM_MAX_OBJECTS",
};

/**
 * The budgets in force. A value that is not a positive integer is ignored, never a
 * reason to switch a budget off: a typo in the environment must not open the service.
 */
export function quotaSettings(env = process.env, { maxFrameBytes = 16 * MiB } = {}) {
  const out = { ...QUOTA_DEFAULTS };
  for (const [key, name] of Object.entries(ENV)) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) out[key] = value;
  }
  // A burst smaller than the largest accepted frame would refuse that frame forever:
  // the client resends it on every reconnect and is closed every time.
  out.socketBurst = Math.max(out.socketBurst, maxFrameBytes);
  out.orgBurst = Math.max(out.orgBurst, out.socketBurst);
  return out;
}

/** Bytes per second with a burst; `take` is all or nothing. */
export class TokenBucket {
  constructor(rate, burst, now) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }

  refill(now) {
    if (now > this.at) {
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
      this.at = now;
    }
  }

  take(bytes, now) {
    this.refill(now);
    if (bytes > this.tokens) return false;
    this.tokens -= bytes;
    return true;
  }

  give(bytes) {
    this.tokens = Math.min(this.burst, this.tokens + bytes);
  }

  full(now) {
    this.refill(now);
    return this.tokens >= this.burst;
  }
}

const MESSAGE_SYNC = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

/**
 * Whether a frame carries document content: a sync step 2 or an update. Awareness,
 * the step 1 request and the app's own signals do not grow the document.
 */
export function isContentFrame(bytes) {
  if (!bytes?.length) return false;
  try {
    const decoder = decoding.createDecoder(bytes);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return false;
    const step = decoding.readVarUint(decoder);
    return step === SYNC_STEP_2 || step === SYNC_UPDATE;
  } catch {
    return false;
  }
}

/**
 * Widget ids a content frame would add, or an empty list when it only edits existing
 * ones. Yjs encodes a map entry as an Item whose parent is the root map name and whose
 * `parentSub` is the key, so this is a cheap structural check, not a full apply.
 */
export function introducedWidgetIds(data, widgets) {
  if (!data) return [];
  try {
    // `data` is the whole sync frame in production and the bare update in tests;
    // accept both so the check does not depend on who calls it.
    let payload = data;
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarUint(decoder) === MESSAGE_SYNC) {
      const step = decoding.readVarUint(decoder);
      if (step === SYNC_STEP_2 || step === SYNC_UPDATE) {
        payload = decoding.readVarUint8Array(decoder);
      }
    }
    const { structs } = Y.decodeUpdate(payload);
    const ids = [];
    for (const struct of structs) {
      if (
        struct?.parent === "widgets" &&
        typeof struct.parentSub === "string" &&
        !widgets.has(struct.parentSub)
      ) {
        ids.push(struct.parentSub);
      }
    }
    return ids;
  } catch {
    // A frame the decoder cannot read is not a widget write; y-websocket rejects it.
    return [];
  }
}

/** Beyond this many organisation buckets, forget the ones that are full again. */
const MAX_ORG_BUCKETS = 10_000;

/**
 * One quota for the process.
 *
 * `measure(doc)` returns the document's encoded size; it is O(document) and is called
 * once when a room is first charged and again only when the running estimate passes
 * the ceiling, so the common path never encodes the document.
 */
export function createWsQuota({ settings = quotaSettings(), now = Date.now, measure }) {
  const orgBuckets = new Map();
  /** Running upper bound of each room's size, keyed by the live Y.Doc. */
  const roomBytes = new WeakMap();

  function orgBucket(orgKey) {
    let bucket = orgBuckets.get(orgKey);
    if (bucket) return bucket;
    if (orgBuckets.size >= MAX_ORG_BUCKETS) {
      const t = now();
      for (const [key, candidate] of orgBuckets) {
        if (candidate.full(t)) orgBuckets.delete(key);
      }
    }
    bucket = new TokenBucket(settings.orgRate, settings.orgBurst, now());
    orgBuckets.set(orgKey, bucket);
    return bucket;
  }

  function roomIsFull(doc) {
    if (!doc) return false;
    let size = roomBytes.get(doc);
    if (size === undefined) {
      size = measure(doc);
      roomBytes.set(doc, size);
    }
    if (size < settings.roomMaxBytes) return false;
    // The estimate only grows (a deletion is counted as bytes too); measure before
    // refusing anything.
    size = measure(doc);
    roomBytes.set(doc, size);
    return size >= settings.roomMaxBytes;
  }

  return {
    settings,

    /** Per-socket state; `orgKey` is the organisation, or the room when it has none. */
    open({ orgKey }) {
      return {
        bucket: new TokenBucket(settings.socketRate, settings.socketBurst, now()),
        orgKey: orgKey ?? null,
      };
    },

    /**
     * `"allow"`, `"room-full"` or `"rate"` for one inbound frame.
     *
     * `doc` is the room's live document; it is only needed for content frames.
     */
    decide(state, { bytes, content, doc, data }) {
      if (content && bytes > settings.smallFrame && roomIsFull(doc)) return "room-full";
      // The object ceiling is checked on every content frame, not only a large one:
      // a script can add one widget per 16 KiB frame. Existing widgets still edit.
      if (content && doc?.getMap) {
        const widgets = doc.getMap("widgets");
        const maxObjects = settings.maxObjects ?? Number.POSITIVE_INFINITY;
        if (widgets && widgets.size >= maxObjects) {
          if (introducedWidgetIds(data, widgets).length) return "room-full";
        }
      }
      const t = now();
      if (!state.bucket.take(bytes, t)) return "rate";
      if (state.orgKey !== null && !orgBucket(state.orgKey).take(bytes, t)) {
        state.bucket.give(bytes);
        return "rate";
      }
      if (content && doc) {
        const size = roomBytes.get(doc);
        if (size !== undefined) roomBytes.set(doc, size + bytes);
      }
      return "allow";
    },

    /** Test hook: organisation buckets held. */
    orgBucketCount: () => orgBuckets.size,
  };
}

function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return null;
}

/**
 * Wrap a socket's `emit` so a frame over budget never reaches y-websocket.
 *
 * Installed after the read-only guard, so it runs first and counts every frame,
 * including the ones a read-only socket would drop.
 */
export function guardQuota(socket, { quota, state, room, onLimit }) {
  const original = socket.emit.bind(socket);
  let closed = false;
  socket.emit = (event, ...args) => {
    if (event === "message") {
      if (closed) return false;
      const bytes = bytesOf(args[0]);
      if (bytes) {
        const content = isContentFrame(bytes);
        const decision = quota.decide(state, {
          bytes: bytes.length,
          content,
          doc: content ? room() : null,
          data: content ? bytes : null,
        });
        if (decision !== "allow") {
          closed = true;
          onLimit?.(decision);
          socket.close(
            decision === "rate" ? CLOSE_RATE_LIMITED : CLOSE_ROOM_FULL,
            decision === "rate" ? "write rate limit" : "room is full",
          );
          return false;
        }
      }
    }
    return original(event, ...args);
  };
  return () => {
    socket.emit = original;
  };
}
