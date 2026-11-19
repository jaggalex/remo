import { describe, expect, it, vi } from "vitest";
import { createConnections } from "./sync-connections.mjs";
import { encodeVotesChanged, VOTES_CHANGED_MESSAGE } from "./vote-signal.mjs";

/** Open socket stand-in: `readyState = 1` is what the notifier looks for. */
function socket() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() };
}

describe("votes changed signal", () => {
  it("is one empty frame of type 12", () => {
    const frame = encodeVotesChanged();
    expect([...frame]).toEqual([VOTES_CHANGED_MESSAGE]);
    expect(VOTES_CHANGED_MESSAGE).toBe(12);
  });

  it("does not collide with the comments nudge", () => {
    expect(VOTES_CHANGED_MESSAGE).not.toBe(11);
  });

  it("reaches every open socket of one board and nobody else", () => {
    const connections = createConnections({
      store: {},
      accessForBoard: async () => null,
      log: { error: () => {} },
    });
    const first = socket();
    const other = socket();
    connections.registerConnection("board-a", { socket: first });
    connections.registerConnection("board-b", { socket: other });

    const sent = connections.notifyBoard("board-a", encodeVotesChanged());

    expect(sent).toBe(1);
    expect(first.send).toHaveBeenCalledOnce();
    expect(other.send).not.toHaveBeenCalled();
    connections.stopSweep();
  });
});
