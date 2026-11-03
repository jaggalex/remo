import { describe, expect, it } from "vitest";
import { readPresence, type AwarenessLike, type PresenceUser } from "./presence";

function awareness(
  states: Array<[clientId: number, user: PresenceUser]>,
  clientID = 1,
): AwarenessLike {
  const map = new Map<number, Record<string, unknown>>();
  for (const [clientId, user] of states) map.set(clientId, { user });
  return {
    clientID,
    getStates: () => map,
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  };
}

const user = (over: Partial<PresenceUser> = {}): PresenceUser => ({
  name: "Alexander Kostylev",
  color: "#2d9bf0",
  sessionKey: "session-a",
  accountId: "user-a",
  joinedAt: 1_000,
  ...over,
});

describe("presence (ADR-151)", () => {
  it("keeps two sessions of one account and suffixes the later one", () => {
    const entries = readPresence(
      awareness([
        [1, user({ sessionKey: "session-a", joinedAt: 1_000 })],
        [2, user({ sessionKey: "session-b", joinedAt: 2_000 })],
      ]),
      "session-b",
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.label).sort()).toEqual([
      "Alexander Kostylev",
      "Alexander Kostylev (2)",
    ]);
    expect(entries.find((entry) => entry.sessionKey === "session-b")?.self).toBe(true);
    expect(entries.find((entry) => entry.sessionKey === "session-a")?.self).toBe(false);
  });

  it("orders the suffix by join time, not by map order", () => {
    const entries = readPresence(
      awareness([
        [7, user({ sessionKey: "late", joinedAt: 9_000 })],
        [2, user({ sessionKey: "early", joinedAt: 1_000 })],
      ]),
      null,
    );
    expect(entries.find((entry) => entry.sessionKey === "early")?.label).toBe("Alexander Kostylev");
    expect(entries.find((entry) => entry.sessionKey === "late")?.label).toBe("Alexander Kostylev (2)");
  });

  it("does not suffix explicitly different names in one account", () => {
    const entries = readPresence(
      awareness([
        [1, user({ name: "Alice", sessionKey: "alice" })],
        [2, user({ name: "Bob", sessionKey: "bob", joinedAt: 2_000 })],
      ]),
      "alice",
    );
    expect(entries.map((entry) => entry.label).sort()).toEqual(["Alice", "Bob"]);
  });

  it("never suffixes guests, who have no account to group them", () => {
    const entries = readPresence(
      awareness([
        [1, user({ accountId: null, sessionKey: "g1", joinedAt: 1_000 })],
        [2, user({ accountId: null, sessionKey: "g2", joinedAt: 2_000 })],
      ]),
      "g1",
    );
    expect(entries.map((entry) => entry.label)).toEqual(["Alexander Kostylev", "Alexander Kostylev"]);
  });

  it("marks the local session by key, not by a shared name", () => {
    const entries = readPresence(
      awareness([
        [1, user({ sessionKey: "session-a" })],
        [2, user({ sessionKey: "session-b", joinedAt: 2_000 })],
      ]),
      "session-a",
    );
    expect(entries[0]).toMatchObject({ sessionKey: "session-a", self: true });
    expect(entries.filter((entry) => entry.self)).toHaveLength(1);
  });
});
