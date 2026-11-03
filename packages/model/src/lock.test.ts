import { describe, expect, it } from "vitest";
import { canUnlock, lockAuthorName } from "./lock";

const author = { locked: true, lockedBy: "user-a", lockedByName: "Ann" };

describe("author lock", () => {
  it("lets the author and a manager release it", () => {
    expect(canUnlock(author, "user-a", false)).toBe(true);
    expect(canUnlock(author, "user-b", true)).toBe(true);
  });

  it("refuses another editor and a signed-out actor", () => {
    expect(canUnlock(author, "user-b", false)).toBe(false);
    expect(canUnlock(author, null, false)).toBe(false);
  });

  it("treats a legacy lock as releasable by any editor", () => {
    expect(canUnlock({ locked: true }, "user-b", false)).toBe(true);
  });

  it("always allows an unlocked object", () => {
    expect(canUnlock({}, "user-b", false)).toBe(true);
  });

  it("names the author, falling back to the id", () => {
    expect(lockAuthorName(author)).toBe("Ann");
    expect(lockAuthorName({ lockedBy: "user-a" })).toBe("user-a");
    expect(lockAuthorName({})).toBeNull();
  });
});
