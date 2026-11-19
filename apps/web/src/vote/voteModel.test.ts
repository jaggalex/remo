import { describe, expect, it } from "vitest";
import type { VoteSession } from "./voteTypes";
import {
  barWidth,
  leaderRows,
  objectVoters,
  rankRows,
  sameDeadline,
  showsVoters,
  totalVotes,
  voteRows,
} from "./voteModel";

function session(partial: Partial<VoteSession>): VoteSession {
  return {
    id: "s1",
    boardId: "b1",
    createdBy: "u1",
    createdByName: "Ann",
    objectIds: [],
    votesPerSubject: 3,
    anonymous: true,
    state: "ended",
    endsAt: null,
    endedAt: null,
    publishedAt: null,
    createdAt: "2026-10-29T10:00:00.000Z",
    votes: [],
    voters: 0,
    myVotes: 0,
    myObjectIds: [],
    remaining: 3,
    serverNow: "2026-10-29T10:01:00.000Z",
    ...partial,
  };
}

describe("vote rows", () => {
  it("keeps every object in scope, including the ones without votes", () => {
    const rows = voteRows(
      session({
        objectIds: ["a", "b", "c"],
        votes: [{ object_id: "b", votes: 2 }],
      }),
    );
    expect(rows).toEqual([
      { objectId: "a", votes: 0 },
      { objectId: "b", votes: 2 },
      { objectId: "c", votes: 0 },
    ]);
    expect(totalVotes(rows)).toBe(2);
  });
});

describe("rankRows", () => {
  it("gives a tie the same place and skips the place it covers", () => {
    const { rows, ties } = rankRows([
      { objectId: "a", votes: 5 },
      { objectId: "b", votes: 3 },
      { objectId: "c", votes: 3 },
      { objectId: "d", votes: 1 },
    ]);
    expect(rows.map((row) => [row.objectId, row.place, row.placeEnd])).toEqual([
      ["a", 1, 1],
      ["b", 2, 3],
      ["c", 2, 3],
      ["d", 4, 4],
    ]);
    expect(ties).toHaveLength(1);
    expect(ties[0]).toMatchObject({ from: 2, to: 3 });
    expect(ties[0]!.rows.map((row) => row.objectId)).toEqual(["b", "c"]);
  });

  it("counts a shared first place among the leaders", () => {
    const { rows } = rankRows([
      { objectId: "a", votes: 4 },
      { objectId: "b", votes: 4 },
      { objectId: "c", votes: 1 },
    ]);
    expect(leaderRows(rows).map((row) => row.objectId)).toEqual(["a", "b"]);
  });

  it("has no leaders when nobody voted", () => {
    const { rows } = rankRows([
      { objectId: "a", votes: 0 },
      { objectId: "b", votes: 0 },
    ]);
    expect(leaderRows(rows)).toEqual([]);
  });
});

describe("barWidth", () => {
  it("measures against the leader and never divides by zero", () => {
    expect(barWidth({ objectId: "a", votes: 2 }, 4)).toBe("50%");
    expect(barWidth({ objectId: "a", votes: 0 }, 0)).toBe("0%");
  });
});

describe("sameDeadline", () => {
  it("matches the timer's instant, not a nearby one", () => {
    expect(
      sameDeadline("2026-10-29T12:00:00.000Z", "2026-10-29T12:00:00.400Z"),
    ).toBe(true);
    expect(sameDeadline("2026-10-29T12:00:00.000Z", "2026-10-29T12:01:00.000Z")).toBe(
      false,
    );
    expect(sameDeadline(null, "2026-10-29T12:00:00.000Z")).toBe(false);
  });
});

describe("who voted", () => {
  // ADR-126: names exist only in an ended open session. A running or anonymous session
  // sends no `breakdown`, so there is nothing to open — not an empty list.
  it("has nothing to show without a breakdown", () => {
    const running = session({ objectIds: ["a"], state: "open" });
    expect(showsVoters(running)).toBe(false);
    expect(objectVoters(running, "a")).toBeNull();
  });

  it("reads the voters of one object when the server sent them", () => {
    const ended = session({
      objectIds: ["a"],
      votes: [{ object_id: "a", votes: 2 }],
      breakdown: {
        objects: [
          {
            object_id: "a",
            voters: [
              { name: "Ann", votes: 1 },
              { name: null, votes: 1 },
            ],
            guests: { voters: 1, votes: 1 },
          },
        ],
        summary: [{ name: "Ann", total: 1, objects: 1 }],
        guests: { voters: 1, votes: 1 },
      },
    });
    expect(showsVoters(ended)).toBe(true);
    expect(objectVoters(ended, "a")?.voters.map((voter) => voter.name)).toEqual([
      "Ann",
      null,
    ]);
    expect(objectVoters(ended, "a")?.guests).toEqual({ voters: 1, votes: 1 });
    // An object nobody voted for has no row of its own.
    expect(objectVoters(ended, "b")).toBeNull();
  });
});
