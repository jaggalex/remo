import { describe, expect, it } from "vitest";
import { decodeSaveAck, encodeSaveAck, isSyncStep1, isSyncStep2, SAVE_ACK_MESSAGE } from "./save-ack.mjs";

describe("server save ack frames", () => {
  it("reads the same cumulative sequence the client sends", () => {
    expect(decodeSaveAck(encodeSaveAck(1234))).toBe(1234);
    expect(encodeSaveAck(1)[0]).toBe(SAVE_ACK_MESSAGE);
  });

  it("recognises only a sync step 1", () => {
    expect(isSyncStep1(new Uint8Array([0, 0, 1, 2]))).toBe(true);
    expect(isSyncStep1(new Uint8Array([0, 1, 1, 2]))).toBe(false);
    expect(isSyncStep1(new Uint8Array([SAVE_ACK_MESSAGE, 0, 0, 0, 1]))).toBe(false);
  });

  it("recognises a sync step 2", () => {
    expect(isSyncStep2(new Uint8Array([0, 1, 1, 2]))).toBe(true);
    expect(isSyncStep2(new Uint8Array([0, 0, 1, 2]))).toBe(false);
    expect(isSyncStep2(new Uint8Array([SAVE_ACK_MESSAGE, 0, 0, 0, 1]))).toBe(false);
  });
});
