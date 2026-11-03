/**
 * Save acknowledgement frames (ADR-084).
 *
 * Mirrors `packages/doc/src/save-status.ts`. The client sends `[10, seq:uint32]`; the
 * server echoes the highest sequence it has persisted. The type is outside the Yjs
 * range (0 sync, 1 awareness, 2 auth, 3 query), so old peers ignore it.
 */
import * as decoding from "lib0/decoding";

export const SAVE_ACK_MESSAGE = 10;
export const SAVE_ACK_FRAME_SIZE = 5;

export function encodeSaveAck(sequence) {
  const value = Math.max(0, Math.floor(sequence)) >>> 0;
  return new Uint8Array([
    SAVE_ACK_MESSAGE,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

export function decodeSaveAck(bytes) {
  if (!bytes || bytes.length < SAVE_ACK_FRAME_SIZE || bytes[0] !== SAVE_ACK_MESSAGE) {
    return null;
  }
  return (
    (((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0)
  );
}

/**
 * A client sync step 1: `[messageSync, messageYjsSyncStep1, ...]`.
 *
 * Both values are varints. Reading them through the decoder matters for a non-canonical
 * zero (`0x80 0x00`), which indexes as a different message but means the same thing.
 */
export function isSyncStep1(bytes) {
  if (!bytes || bytes.length < 2) return false;
  try {
    const decoder = decoding.createDecoder(bytes);
    return decoding.readVarUint(decoder) === 0 && decoding.readVarUint(decoder) === 0;
  } catch {
    return false;
  }
}
