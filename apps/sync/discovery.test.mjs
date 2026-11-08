/**
 * Discovery rules (ENT-07): what appears in the board directory and in search.
 *
 * Pure logic over a store-shaped object, so the rules are tested without a database;
 * the SQL they call is exercised by the IAM API suite.
 */
import { describe, expect, it } from "vitest";
import { discoverableBoardIds, discoverableBoards } from "./discovery.mjs";

function store({ readable = [], rooms = {}, iam = {} } = {}) {
  return {
    listReadableBoards: async () => readable,
    getIamBoard: async (id) => iam[id] ?? null,
    getBoard: async (id) => rooms[id] ?? null,
  };
}

describe("discovery", () => {
  it("returns nothing for a visitor with no session and no room", async () => {
    const boards = await discoverableBoards(store({ readable: [{ id: "secret" }] }), {});
    expect(boards).toEqual([]);
  });

  it("returns only the boards the person may read", async () => {
    const boards = await discoverableBoards(
      store({ readable: [{ id: "one" }, { id: "two" }] }),
      { userId: "u1" },
    );
    expect(boards.map((board) => board.id)).toEqual(["one", "two"]);
  });

  it("does not surface an unowned room, even when it is named", async () => {
    const fake = store({
      readable: [],
      iam: { legacy: { id: "legacy", owner_id: null } },
      rooms: { legacy: { id: "legacy", title: "Old room" } },
    });
    expect(await discoverableBoards(fake, {})).toEqual([]);
    // It is closed (ADR-174); listing it would only offer a door that answers 403.
    expect(await discoverableBoards(fake, { room: "legacy" })).toEqual([]);
  });

  it("does not surface a claimed board through the room parameter", async () => {
    const fake = store({
      readable: [],
      iam: { private: { id: "private", owner_id: "someone-else" } },
      rooms: { private: { id: "private", title: "Private" } },
    });
    expect(await discoverableBoards(fake, { room: "private" })).toEqual([]);
  });

  it("does not repeat a board that is both readable and current", async () => {
    const fake = store({
      readable: [{ id: "mine", title: "Mine" }],
      iam: { mine: { id: "mine", owner_id: "u1" } },
      rooms: { mine: { id: "mine", title: "Mine" } },
    });
    const boards = await discoverableBoards(fake, { userId: "u1", room: "mine" });
    expect(boards).toHaveLength(1);
    expect(await discoverableBoardIds(fake, { userId: "u1", room: "mine" })).toEqual(["mine"]);
  });
});
