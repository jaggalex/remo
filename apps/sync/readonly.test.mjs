import { describe, expect, it } from "vitest";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { Y } from "./y.mjs";
import { decideReadOnlyMessage, guardReadOnly } from "./readonly.mjs";

/**
 * A viewer must not be able to write, and "the UI hides the button" is not a control
 * (ADR-062). These tests pin the protocol decision, frame by frame.
 */

const frame = (...bytes) => Uint8Array.from(bytes);
const SYNC_STEP_1 = frame(0, 0, 1, 2);
const SYNC_STEP_2 = frame(0, 1, 9, 9);
const SYNC_UPDATE = frame(0, 2, 9, 9);
const AWARENESS = frame(1, 1, 2, 3);

describe("read-only socket frames", () => {
  it("allows the one initial state request and then nothing else", () => {
    const state = { readOnly: true, initialRequestUsed: false };
    expect(decideReadOnlyMessage(SYNC_STEP_1, state)).toBe("allow");
    expect(decideReadOnlyMessage(SYNC_STEP_1, state)).toBe("drop");
    expect(decideReadOnlyMessage(SYNC_UPDATE, state)).toBe("drop");
  });

  it("drops an update even before the initial request", () => {
    const state = { readOnly: true, initialRequestUsed: false };
    expect(decideReadOnlyMessage(SYNC_UPDATE, state)).toBe("drop");
  });

  it("drops step 2 as well, because it carries updates", () => {
    const state = { readOnly: true, initialRequestUsed: true };
    expect(decideReadOnlyMessage(SYNC_STEP_2, state)).toBe("drop");
  });

  it("lets awareness through: cursors are not content", () => {
    const state = { readOnly: true, initialRequestUsed: true };
    expect(decideReadOnlyMessage(AWARENESS, state)).toBe("allow");
  });

  it("lets a writer send anything", () => {
    const state = { readOnly: false, initialRequestUsed: false };
    expect(decideReadOnlyMessage(SYNC_UPDATE, state)).toBe("allow");
    expect(decideReadOnlyMessage(SYNC_STEP_2, state)).toBe("allow");
  });

  it("reads the type as a varint, not as the first byte", () => {
    // A non-canonical encoding of zero: the first byte is 0x80, the value is 0.
    // Indexing `bytes[0]` would classify this as awareness and let it through.
    const state = { readOnly: true, initialRequestUsed: false };
    const disguisedSyncStep1 = frame(0x80, 0x00, 0x80, 0x00, 1);
    expect(disguisedSyncStep1[0]).not.toBe(0);
    expect(decideReadOnlyMessage(disguisedSyncStep1, state)).toBe("allow");

    const disguisedUpdate = frame(0x80, 0x00, 0x82, 0x00, 1, 2);
    const second = { readOnly: true, initialRequestUsed: false };
    expect(decideReadOnlyMessage(disguisedUpdate, second)).toBe("drop");
  });

  it("drops a real update encoded with alternative varints, leaving the document alone", () => {
    const source = new Y.Doc();
    source.getMap("widgets").set("w1", { id: "w1", type: "sticky_note" });
    const update = Y.encodeStateAsUpdate(source);

    // [sync, update, updateBytes], with both varints written non-canonically.
    const tail = encoding.createEncoder();
    encoding.writeVarUint8Array(tail, update);
    const updateTail = encoding.toUint8Array(tail);
    const bytes = new Uint8Array(4 + updateTail.length);
    bytes.set([0x80, 0x00, 0x82, 0x00]); // sync = 0, step = 2 (update)
    bytes.set(updateTail, 4);

    // The very same bytes are a genuine update to Yjs...
    const decoder = decoding.createDecoder(bytes);
    expect(decoding.readVarUint(decoder)).toBe(0);
    expect(decoding.readVarUint(decoder)).toBe(2);
    const target = new Y.Doc();
    Y.applyUpdate(target, decoding.readVarUint8Array(decoder));
    expect(target.getMap("widgets").get("w1")).toMatchObject({ id: "w1" });

    // ...and the read-only guard refuses them, so a second document stays empty.
    const state = { readOnly: true, initialRequestUsed: true };
    expect(decideReadOnlyMessage(bytes, state)).toBe("drop");
    const untouched = new Y.Doc();
    expect(untouched.getMap("widgets").size).toBe(0);
  });

  it("rejects a frame it cannot read instead of guessing", () => {
    const state = { readOnly: true, initialRequestUsed: false };
    expect(decideReadOnlyMessage(null, state)).toBe("drop");
    expect(decideReadOnlyMessage(frame(), state)).toBe("drop");
  });
});

describe("guarding a socket", () => {
  function fakeSocket() {
    const seen = [];
    return {
      seen,
      emit(event, ...args) {
        seen.push({ event, args });
        return true;
      },
    };
  }

  it("swallows dropped frames and counts them", () => {
    const socket = fakeSocket();
    let drops = 0;
    guardReadOnly(socket, { readOnly: true, initialRequestUsed: false }, () => {
      drops += 1;
    });

    socket.emit("message", SYNC_STEP_1);
    socket.emit("message", SYNC_UPDATE);
    socket.emit("message", AWARENESS);

    expect(socket.seen).toHaveLength(2);
    expect(drops).toBe(1);
  });

  it("can be removed, leaving the socket as it was", () => {
    const socket = fakeSocket();
    const restore = guardReadOnly(socket, { readOnly: true, initialRequestUsed: true }, () => {});
    restore();
    socket.emit("message", SYNC_UPDATE);
    expect(socket.seen).toHaveLength(1);
  });
});
