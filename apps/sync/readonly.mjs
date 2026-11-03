/**
 * Read-only enforcement at the socket (ADR-062, spec/IAM-v1.md §7).
 *
 * y-websocket's server has no notion of a read-only client: it applies any sync message
 * it receives. A viewer must therefore be stopped *before* the library sees the frame,
 * not by hiding buttons in the UI.
 *
 * The type and step are varints, so they cannot be read by indexing bytes: a non-canonical
 * encoding of zero (`0x80 0x00`) has a first byte that is not `0` but still decodes to
 * the sync message. This module therefore uses the same decoder as Yjs and allows exactly
 * one `syncStep1` — the request that makes the server send the document — plus awareness,
 * which is cursors rather than content. Every other frame is dropped.
 *
 * `syncStep2` is dropped too: it carries updates.
 */
import * as decoding from "lib0/decoding";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SYNC_STEP_1 = 0;

function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return null;
}

/**
 * The frame's message type and, for a sync frame, its step. Both are varints; a frame
 * that cannot be decoded is not guessed at.
 */
function readFrame(bytes) {
  if (!bytes.length) return null;
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type !== MESSAGE_SYNC) return { type, step: null };
    if (!decoding.hasContent(decoder)) return { type, step: null };
    return { type, step: decoding.readVarUint(decoder) };
  } catch {
    return null;
  }
}

/**
 * @returns {"allow"|"drop"} and mutates `state.initialRequestUsed` when the one allowed
 * request is consumed.
 */
export function decideReadOnlyMessage(data, state) {
  if (!state.readOnly) return "allow";
  const bytes = bytesOf(data);
  if (!bytes) return "drop";
  const frame = readFrame(bytes);
  if (!frame) return "drop";

  // Awareness (cursors) is not content and is allowed both ways.
  if (frame.type === MESSAGE_AWARENESS) return "allow";

  // Exactly one sync step 1: the request that asks for the document.
  if (
    frame.type === MESSAGE_SYNC &&
    frame.step === SYNC_STEP_1 &&
    !state.initialRequestUsed
  ) {
    state.initialRequestUsed = true;
    return "allow";
  }
  return "drop";
}

/**
 * Wrap a socket's `emit` so dropped frames never reach y-websocket.
 *
 * `emit` is the one point every incoming frame passes through; wrapping it is less
 * invasive than replacing the library's message handler.
 */
export function guardReadOnly(socket, state, onDrop) {
  const original = socket.emit.bind(socket);
  socket.emit = (event, ...args) => {
    if (event === "message") {
      const decision = decideReadOnlyMessage(args[0], state);
      if (decision === "drop") {
        onDrop?.();
        return false;
      }
    }
    return original(event, ...args);
  };
  return () => {
    socket.emit = original;
  };
}
