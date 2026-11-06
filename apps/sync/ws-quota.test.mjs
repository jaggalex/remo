import { EventEmitter } from "node:events";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CLOSE_RATE_LIMITED,
  CLOSE_ROOM_FULL,
  QUOTA_DEFAULTS,
  TokenBucket,
  createWsQuota,
  guardQuota,
  introducedWidgetIds,
  isContentFrame,
  quotaSettings,
} from "./ws-quota.mjs";

const KiB = 1024;
const MiB = 1024 * KiB;

/** A sync frame: message type 0, then the step, then a payload of `size` bytes. */
function syncFrame(step, size = 8) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, step);
  encoding.writeVarUint8Array(encoder, new Uint8Array(size));
  return encoding.toUint8Array(encoder);
}

/** A real sync update frame: message type 0, step 2, then the Yjs update. */
function updateFrame(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function awarenessFrame(size = 8) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint8Array(encoder, new Uint8Array(size));
  return encoding.toUint8Array(encoder);
}

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const small = { socketRate: 10 * KiB, socketBurst: 100 * KiB, orgRate: 20 * KiB, orgBurst: 150 * KiB, roomMaxBytes: 1 * MiB, smallFrame: 1 * KiB };

describe("quota settings (ADR-173)", () => {
  it("uses the defaults and keeps the burst above the largest frame", () => {
    const settings = quotaSettings({}, { maxFrameBytes: 16 * MiB });
    expect(settings.socketRate).toBe(QUOTA_DEFAULTS.socketRate);
    expect(settings.socketBurst).toBeGreaterThanOrEqual(16 * MiB);
    expect(settings.orgBurst).toBeGreaterThanOrEqual(settings.socketBurst);
  });

  it("reads overrides and ignores values that would switch a budget off", () => {
    const settings = quotaSettings(
      { REMO_WS_RATE_BYTES: "1024", REMO_ROOM_MAX_BYTES: "0", REMO_ORG_WS_RATE_BYTES: "abc" },
      { maxFrameBytes: 1 },
    );
    expect(settings.socketRate).toBe(1024);
    expect(settings.roomMaxBytes).toBe(QUOTA_DEFAULTS.roomMaxBytes);
    expect(settings.orgRate).toBe(QUOTA_DEFAULTS.orgRate);
  });
});

describe("TokenBucket", () => {
  it("spends, refuses beyond the balance and refills over time", () => {
    const bucket = new TokenBucket(100, 1000, 0);
    expect(bucket.take(900, 0)).toBe(true);
    expect(bucket.take(200, 0)).toBe(false);
    expect(bucket.take(200, 1000)).toBe(true); // +100 after one second
    expect(bucket.full(100_000)).toBe(true);
  });
});

describe("isContentFrame", () => {
  it("counts sync step 2 and updates, not the request, awareness or junk", () => {
    expect(isContentFrame(syncFrame(1))).toBe(true);
    expect(isContentFrame(syncFrame(2))).toBe(true);
    expect(isContentFrame(syncFrame(0))).toBe(false);
    expect(isContentFrame(awarenessFrame())).toBe(false);
    expect(isContentFrame(new Uint8Array([0x80]))).toBe(false);
    expect(isContentFrame(new Uint8Array())).toBe(false);
  });
});

describe("createWsQuota", () => {
  it("refuses a socket that writes faster than its budget, then lets it recover", () => {
    const time = clock();
    const quota = createWsQuota({ settings: small, now: time.now, measure: () => 0 });
    const state = quota.open({ orgKey: "org-a" });
    expect(quota.decide(state, { bytes: 90 * KiB, content: false })).toBe("allow");
    expect(quota.decide(state, { bytes: 20 * KiB, content: false })).toBe("rate");
    time.advance(2000);
    expect(quota.decide(state, { bytes: 20 * KiB, content: false })).toBe("allow");
  });

  it("shares one budget across an organisation and keeps tenants apart", () => {
    const time = clock();
    const quota = createWsQuota({ settings: small, now: time.now, measure: () => 0 });
    const a1 = quota.open({ orgKey: "org-a" });
    const a2 = quota.open({ orgKey: "org-a" });
    const b = quota.open({ orgKey: "org-b" });
    expect(quota.decide(a1, { bytes: 90 * KiB, content: false })).toBe("allow");
    // The second socket has its own 100 KiB, but the organisation has 60 KiB left.
    expect(quota.decide(a2, { bytes: 80 * KiB, content: false })).toBe("rate");
    // The refusal did not spend the socket's own budget.
    expect(quota.decide(a2, { bytes: 50 * KiB, content: false })).toBe("allow");
    // Another organisation is unaffected.
    expect(quota.decide(b, { bytes: 90 * KiB, content: false })).toBe("allow");
  });

  it("takes only small content frames once a room is full", () => {
    const time = clock();
    let measured = 0;
    const doc = {};
    let size = 2 * MiB;
    const quota = createWsQuota({
      settings: { ...small, socketBurst: 10 * MiB, orgBurst: 10 * MiB },
      now: time.now,
      measure: () => {
        measured += 1;
        return size;
      },
    });
    const state = quota.open({ orgKey: null });
    expect(quota.decide(state, { bytes: 512, content: true, doc })).toBe("allow");
    expect(quota.decide(state, { bytes: 4 * KiB, content: true, doc })).toBe("room-full");
    // Awareness and other non-content frames are never refused for size.
    expect(quota.decide(state, { bytes: 4 * KiB, content: false, doc })).toBe("allow");
    // After a cleanup the room is measured again and accepts large frames.
    size = 100 * KiB;
    expect(quota.decide(state, { bytes: 4 * KiB, content: true, doc })).toBe("allow");
    expect(measured).toBeGreaterThanOrEqual(2);
  });

  it("refuses a new widget once the object ceiling is reached, but still edits old ones", () => {
    const doc = new Y.Doc();
    for (let index = 0; index < 3; index += 1) {
      doc.getMap("widgets").set(`w${index}`, { id: `w${index}`, x: index });
    }
    const quota = createWsQuota({
      settings: {
        ...small,
        maxObjects: 3,
        socketBurst: 10 * MiB,
        orgBurst: 10 * MiB,
      },
      measure: () => 0,
    });
    const state = quota.open({ orgKey: null });

    const added = new Y.Doc();
    Y.applyUpdate(added, Y.encodeStateAsUpdate(doc));
    added.getMap("widgets").set("w3", { id: "w3", x: 3 });
    const addUpdate = Y.encodeStateAsUpdate(added, Y.encodeStateVector(doc));
    expect(introducedWidgetIds(addUpdate, doc.getMap("widgets"))).toEqual(["w3"]);
    expect(
      quota.decide(state, {
        bytes: updateFrame(addUpdate).length,
        content: true,
        doc,
        data: updateFrame(addUpdate),
      }),
    ).toBe("room-full");

    const edited = new Y.Doc();
    Y.applyUpdate(edited, Y.encodeStateAsUpdate(doc));
    edited.getMap("widgets").set("w0", { id: "w0", x: 99 });
    const editUpdate = Y.encodeStateAsUpdate(edited, Y.encodeStateVector(doc));
    expect(
      quota.decide(state, {
        bytes: updateFrame(editUpdate).length,
        content: true,
        doc,
        data: updateFrame(editUpdate),
      }),
    ).toBe("allow");
  });

  it("does not measure a room for small frames", () => {
    let measured = 0;
    const quota = createWsQuota({ settings: small, measure: () => (measured += 1) });
    const state = quota.open({ orgKey: null });
    for (let i = 0; i < 50; i += 1) quota.decide(state, { bytes: 100, content: true, doc: {} });
    expect(measured).toBe(0);
  });
});

describe("guardQuota", () => {
  function fakeSocket() {
    const socket = new EventEmitter();
    socket.closed = null;
    socket.close = (code, reason) => {
      socket.closed = { code, reason };
    };
    return socket;
  }

  it("drops the frame over budget, closes with 4429 and drops everything after", () => {
    const time = clock();
    const quota = createWsQuota({ settings: small, now: time.now, measure: () => 0 });
    const socket = fakeSocket();
    const seen = [];
    socket.on("message", (data) => seen.push(data.length));
    const reasons = [];
    guardQuota(socket, {
      quota,
      state: quota.open({ orgKey: "org-a" }),
      room: () => ({}),
      onLimit: (reason) => reasons.push(reason),
    });

    socket.emit("message", awarenessFrame(60 * KiB));
    socket.emit("message", awarenessFrame(60 * KiB));
    socket.emit("message", awarenessFrame(10));
    expect(seen).toHaveLength(1);
    expect(socket.closed?.code).toBe(CLOSE_RATE_LIMITED);
    expect(reasons).toEqual(["rate"]);
  });

  it("closes with 4413 when a large content frame reaches a full room", () => {
    const quota = createWsQuota({ settings: small, measure: () => 2 * MiB });
    const socket = fakeSocket();
    guardQuota(socket, { quota, state: quota.open({ orgKey: null }), room: () => ({}) });
    socket.emit("message", syncFrame(2, 4 * KiB));
    expect(socket.closed?.code).toBe(CLOSE_ROOM_FULL);
  });
});
