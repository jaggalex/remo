import { describe, expect, it } from "vitest";
import { BoardDocument } from "./board";
import { setAllowBringEveryone } from "./facilitation";

describe("bring-everyone setting (ADR-076)", () => {
  it("is off by default and survives as board state", () => {
    const board = new BoardDocument();
    expect(board.snapshot().allowBringEveryone).toBe(false);
    setAllowBringEveryone(board, true);
    expect(board.snapshot().allowBringEveryone).toBe(true);
    setAllowBringEveryone(board, false);
    expect(board.snapshot().allowBringEveryone).toBe(false);
  });
});
