import { describe, expect, it, vi } from "vitest";
import { createSaveAcks } from "./sync-save-ack.mjs";
import { encodeSaveAck } from "./save-ack.mjs";

function socket() {
  return { readyState: 1, send: vi.fn() };
}

function acks(pending = false) {
  return createSaveAcks({
    store: { hasPendingWrites: () => pending },
    getYDoc: () => ({ getMap: () => new Map() }),
    authBySocket: new WeakMap(),
    emitMetric: () => {},
  });
}

describe("save acknowledgements wait for the client's updates", () => {
  it("does not acknowledge before sync step 2", () => {
    const saves = acks(false);
    const ws = socket();
    saves.queueSaveAck("board", ws, 5);
    expect(ws.send).not.toHaveBeenCalled();

    saves.markSyncReady(ws);
    saves.flushSaveAcks("board");
    expect(ws.send).toHaveBeenCalledWith(encodeSaveAck(5));
  });

  it("waits for the store when the update is still pending", () => {
    const saves = acks(true);
    const ws = socket();
    saves.queueSaveAck("board", ws, 7);
    saves.markSyncReady(ws);
    // Nothing is flushed until the store reports the write landed.
    expect(ws.send).not.toHaveBeenCalled();
    saves.flushSaveAcks("board");
    expect(ws.send).toHaveBeenCalledWith(encodeSaveAck(7));
  });
});
