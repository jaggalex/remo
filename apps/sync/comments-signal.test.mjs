import { describe, expect, it, vi } from "vitest";
import { createConnections } from "./sync-connections.mjs";
import { encodeCommentsChanged, COMMENTS_CHANGED_MESSAGE } from "./comment-signal.mjs";

/** Open socket stand-in: `readyState = 1` is what the notifier looks for. */
function socket() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() };
}

describe("comments changed signal", () => {
  it("is one empty frame of type 11", () => {
    const frame = encodeCommentsChanged();
    expect([...frame]).toEqual([COMMENTS_CHANGED_MESSAGE]);
    expect(COMMENTS_CHANGED_MESSAGE).toBe(11);
  });

  it("reaches every open socket of one board and nobody else", () => {
    const connections = createConnections({
      store: {},
      accessForBoard: async () => null,
      log: { error: () => {} },
    });
    const first = socket();
    const second = socket();
    const other = socket();
    const closed = { readyState: 3, send: vi.fn(), close: vi.fn() };
    connections.registerConnection("board-a", { socket: first });
    connections.registerConnection("board-a", { socket: second });
    connections.registerConnection("board-a", { socket: closed });
    connections.registerConnection("board-b", { socket: other });

    const sent = connections.notifyBoard("board-a", encodeCommentsChanged());

    expect(sent).toBe(2);
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledOnce();
    expect(closed.send).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
    connections.stopSweep();
  });

  it("says nothing when nobody is in the room", () => {
    const connections = createConnections({
      store: {},
      accessForBoard: async () => null,
      log: { error: () => {} },
    });
    expect(connections.notifyBoard("empty", encodeCommentsChanged())).toBe(0);
    connections.stopSweep();
  });
});
