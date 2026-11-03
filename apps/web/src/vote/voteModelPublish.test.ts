import { describe, expect, it } from "vitest";
import { publishedVoteText } from "./voteModel";

describe("published vote card (ADR-146)", () => {
  it("is plain lines, not markup", () => {
    const text = publishedVoteText({
      title: "Voting results",
      rows: [
        { label: "US-01: Risks", votes: 3 },
        { label: "US-02: Debt", votes: 2 },
      ],
      meta: "Voted: 5 people",
    });
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text.split("\n")).toEqual([
      "Voting results",
      "1. US-01: Risks — 3",
      "2. US-02: Debt — 2",
      "Voted: 5 people",
    ]);
  });
});
