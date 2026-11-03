import { describe, expect, it } from "vitest";
import {
  computeSaveState,
  decodeSaveAck,
  encodeSaveAck,
  OFFLINE_EDIT_LIMIT,
  SAVE_ACK_MESSAGE,
} from "./save-status";

describe("save acknowledgement protocol (ADR-084)", () => {
  it("round-trips a cumulative sequence", () => {
    const frame = encodeSaveAck(42);
    expect(frame[0]).toBe(SAVE_ACK_MESSAGE);
    expect(decodeSaveAck(frame)).toBe(42);
    expect(decodeSaveAck(encodeSaveAck(0xffff_ffff))).toBe(0xffff_ffff);
  });

  it("rejects another message type or a short frame", () => {
    expect(decodeSaveAck(new Uint8Array([0, 0, 0, 0, 1]))).toBeNull();
    expect(decodeSaveAck(new Uint8Array([SAVE_ACK_MESSAGE, 0]))).toBeNull();
  });
});

describe("save state", () => {
  it("is saved only after sync with no pending updates", () => {
    expect(
      computeSaveState({ connection: "connected", synced: true, pending: 0, blocked: false }),
    ).toEqual({ state: "saved", pending: 0, blocked: false });
  });

  it("is pending while an update waits for an ack", () => {
    expect(
      computeSaveState({ connection: "connected", synced: true, pending: 3, blocked: false }),
    ).toEqual({ state: "pending", pending: 3, blocked: false });
  });

  it("is offline with a count while the socket is down", () => {
    expect(
      computeSaveState({ connection: "disconnected", synced: false, pending: 7, blocked: false }),
    ).toEqual({ state: "offline", pending: 7, blocked: false });
  });

  it("blocks at the offline limit and stays blocked while reconnecting", () => {
    expect(
      computeSaveState({
        connection: "disconnected",
        synced: false,
        pending: OFFLINE_EDIT_LIMIT,
        blocked: true,
      }).blocked,
    ).toBe(true);
    expect(
      computeSaveState({
        connection: "connecting",
        synced: false,
        pending: OFFLINE_EDIT_LIMIT,
        blocked: true,
      }).blocked,
    ).toBe(true);
  });
});
