import { describe, expect, it, vi } from "vitest";
import {
  failRequest,
  failUpgrade,
  isBadInput,
  pathSegments,
  roomFromRequestUrl,
} from "./http-boundary.mjs";

function response() {
  return {
    headersSent: false,
    status: 0,
    headers: {},
    body: "",
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? {};
    },
    end(body) {
      this.ended = true;
      if (body) this.body += body;
    },
  };
}

describe("network boundaries survive bad input", () => {
  it("decodes a room, and reports a malformed percent sequence as URIError", () => {
    expect(roomFromRequestUrl("/my%20room")).toBe("my room");
    expect(() => roomFromRequestUrl("/%E0%A4%A")).toThrow(URIError);
    expect(isBadInput(new URIError("bad"))).toBe(true);
    expect(isBadInput(new Error("other"))).toBe(false);
  });

  it("decodes a path segment exactly once, so an id keeps its meaning", () => {
    // ADR-148: the socket and the HTTP routes must agree on the board id. A non-ASCII id
    // arrives percent-encoded; a literal `%` in an id is already escaped once more.
    const app = new URL(
      "/boards/%D0%B7%D0%B0%D0%BF%D1%83%D1%81%D0%BA-c49e0f86/access",
      "http://localhost",
    );
    expect(pathSegments(app)).toEqual(["boards", "запуск-c49e0f86", "access"]);

    const literal = new URL("/boards/100%25-ready/comments", "http://localhost");
    expect(pathSegments(literal)).toEqual(["boards", "100%-ready", "comments"]);

    expect(() => pathSegments(new URL("/boards/%E0%A4%A", "http://localhost"))).toThrow(
      URIError,
    );
  });

  it("answers a malformed request with 400 instead of throwing", () => {
    const res = response();
    failRequest(res, new URIError("URI malformed"), { error: () => {} });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe("BAD_REQUEST");
    expect(res.ended).toBe(true);
  });

  it("answers an unexpected failure with 500 and does not throw on a dead socket", () => {
    const res = response();
    failRequest(res, new Error("boom"), { error: () => {} });
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toBe("INTERNAL_ERROR");

    const sent = { ...response(), headersSent: true };
    expect(() => failRequest(sent, new Error("late"), { error: () => {} })).not.toThrow();
    expect(sent.ended).toBe(true);
  });

  it("refuses a malformed upgrade without touching the event loop", () => {
    const socket = { write: vi.fn(), destroy: vi.fn() };
    failUpgrade(socket, new URIError("bad"));
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("400 Bad Request"));
    expect(socket.destroy).toHaveBeenCalled();

    const alive = { write: vi.fn(), destroy: vi.fn() };
    const log = { error: vi.fn() };
    failUpgrade(alive, new Error("db down"), log);
    expect(alive.write).not.toHaveBeenCalled();
    expect(alive.destroy).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });
});
