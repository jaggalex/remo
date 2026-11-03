import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { agentFailureText } from "./agentError";

const t = (key: string) => key;

describe("agent failure text", () => {
  it("explains an unreachable service instead of repeating Failed to fetch", () => {
    expect(agentFailureText(new TypeError("Failed to fetch"), t)).toBe("agents.unreachable");
  });

  it("maps access failures to their own instruction", () => {
    expect(agentFailureText(new ApiError(401, "AUTH_REQUIRED", "x"), t)).toBe("agents.authRequired");
    expect(agentFailureText(new ApiError(403, "FORBIDDEN", "x"), t)).toBe("agents.noAccess");
    expect(agentFailureText(new ApiError(404, "NOT_FOUND", "x"), t)).toBe("agents.boardUnavailable");
  });

  it("keeps a server explanation when there is one", () => {
    expect(agentFailureText(new ApiError(422, "BAD_INPUT", "bad budget"), t)).toBe("bad budget");
  });

  it("shows the file field words for the server's file codes", () => {
    expect(agentFailureText(new ApiError(422, "BAD_FILE_TYPE", "attach a .md"), t)).toBe(
      "agents.file.badType",
    );
    expect(agentFailureText(new ApiError(422, "FILE_TOO_LARGE", "too big"), t)).toBe(
      "agents.file.tooLarge",
    );
  });
});
