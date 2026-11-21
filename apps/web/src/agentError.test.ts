import { describe, expect, it } from "vitest";
import { agentFailureText, taskFailureText } from "./agentError";
import { ApiError } from "./api";

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

  it("names the gateway codes from ADR-251 instead of repeating the service text", () => {
    expect(agentFailureText(new ApiError(503, "AI_GATEWAY_UNAVAILABLE", "x"), t)).toBe(
      "agents.aiGatewayUnavailable",
    );
    expect(agentFailureText(new ApiError(423, "KILLED", "AI is temporarily unavailable"), t)).toBe(
      "agents.aiKilled",
    );
    expect(agentFailureText(new ApiError(429, "RATE_LIMITED", "slow down"), t)).toBe(
      "agents.aiRateLimited",
    );
    expect(agentFailureText(new ApiError(403, "PROVIDER_NOT_ALLOWED", "not listed"), t)).toBe(
      "agents.aiProviderNotAllowed",
    );
    expect(agentFailureText(new ApiError(502, "UPSTREAM_ERROR", "provider failed"), t)).toBe(
      "agents.aiUpstreamError",
    );
    expect(agentFailureText(new ApiError(504, "UPSTREAM_TIMEOUT", "slow model"), t)).toBe(
      "agents.aiUpstreamTimeout",
    );
    expect(agentFailureText(new ApiError(503, "GATEWAY_BUSY", "busy"), t)).toBe(
      "agents.aiGatewayBusy",
    );
  });

  it("maps the stored task error \"CODE: detail\" through the same table", () => {
    expect(taskFailureText("KILLED: AI is temporarily unavailable", t)).toBe("agents.aiKilled");
    expect(taskFailureText("AI_GATEWAY_UNAVAILABLE: unreachable", t)).toBe(
      "agents.aiGatewayUnavailable",
    );
    // An unknown code keeps the service's own words rather than inventing a sentence.
    expect(taskFailureText("DRAFT_INVALID: fix the brief", t)).toBe("DRAFT_INVALID: fix the brief");
    expect(taskFailureText(null, t)).toBe("");
  });
});
