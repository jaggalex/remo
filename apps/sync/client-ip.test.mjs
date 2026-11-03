import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./client-ip.mjs";

function request(headers = {}, peer = "10.0.0.5") {
  return { headers, socket: { remoteAddress: peer } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the client address", () => {
  it("uses the socket peer when no proxy is trusted", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }))).toBe("10.0.0.5");
  });

  it("reads the address the trusted proxy appended", () => {
    vi.stubEnv("REMO_TRUST_PROXY", "1");
    // A caller can send the left part; the proxy appends what it actually saw.
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("falls back to X-Real-IP, then the peer, when the chain is unusable", () => {
    vi.stubEnv("REMO_TRUST_PROXY", "1");
    expect(clientIp(request({ "x-forwarded-for": "not-an-ip", "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
    expect(clientIp(request({ "x-forwarded-for": "not-an-ip" }))).toBe("10.0.0.5");
  });

  it("answers a stable key when the socket has no address", () => {
    expect(clientIp({ headers: {}, socket: {} })).toBe("unknown");
  });
});
