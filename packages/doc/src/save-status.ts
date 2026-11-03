/**
 * Save acknowledgement protocol (ADR-084, stage 3).
 *
 * Yjs itself has no per-update acknowledgement: a client can send an update and then
 * only guess whether the server persisted it. The board therefore uses one small
 * message type outside the Yjs range on the same socket:
 *
 *   [10, seq:uint32]
 *
 * The client sends its cumulative local sequence after every edit; the server answers
 * with the highest sequence it has persisted. `seq` is cumulative per tab, so one ack
 * covers every edit up to that number and no per-update bookkeeping is needed.
 */
export const SAVE_ACK_MESSAGE = 10;

/** A tab stops accepting edits after this many unacknowledged local updates offline. */
export const OFFLINE_EDIT_LIMIT = 1000;

export type SaveStateName = "connecting" | "saved" | "pending" | "offline";

export interface SaveState {
  state: SaveStateName;
  /** Local updates not yet acknowledged by the server. */
  pending: number;
  /** The offline queue limit was hit; the UI must stop accepting edits. */
  blocked: boolean;
}

export function encodeSaveAck(sequence: number): Uint8Array {
  const value = Math.max(0, Math.floor(sequence)) >>> 0;
  return new Uint8Array([
    SAVE_ACK_MESSAGE,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

/** Decode a complete frame (or a slice starting at the message type). */
export function decodeSaveAck(bytes: Uint8Array): number | null {
  if (bytes.length < 5 || bytes[0] !== SAVE_ACK_MESSAGE) return null;
  return (
    (((bytes[1]! << 24) | (bytes[2]! << 16) | (bytes[3]! << 8) | bytes[4]!) >>> 0)
  );
}

/**
 * The one place the indicator's words come from. `blocked` is decided by the caller:
 * it means the offline queue limit was reached, not that the board is read-only.
 */
export function computeSaveState({
  connection,
  synced,
  pending,
  blocked,
}: {
  connection: "connecting" | "connected" | "disconnected";
  synced: boolean;
  pending: number;
  blocked: boolean;
}): SaveState {
  const count = Math.max(0, pending);
  if (connection === "disconnected") {
    return { state: "offline", pending: count, blocked };
  }
  if (connection === "connecting" || !synced) {
    return { state: "connecting", pending: count, blocked };
  }
  if (count > 0) return { state: "pending", pending: count, blocked };
  return { state: "saved", pending: 0, blocked: false };
}
