import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedOrigins, csrfProblem, isMutationMethod, originAllowed } from "./csrf.mjs";

function request(method, headers = {}) {
  return { method, headers: { host: "boards.example.com", ...headers }, socket: { encrypted: false } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the CSRF boundary", () => {
  it("treats only unsafe methods as mutations", () => {
    expect(isMutationMethod("GET")).toBe(false);
    expect(isMutationMethod("HEAD")).toBe(false);
    expect(isMutationMethod("OPTIONS")).toBe(false);
    expect(isMutationMethod("POST")).toBe(true);
    expect(isMutationMethod("PATCH")).toBe(true);
    expect(isMutationMethod("DELETE")).toBe(true);
  });

  it("accepts the host the request was addressed to, and the configured app origin", () => {
    vi.stubEnv("REMO_APP_ORIGIN", "https://boards.example.com");
    vi.stubEnv("REMO_CORS_ORIGIN", "*");
    expect([...allowedOrigins(request("POST"))]).toEqual(["http://boards.example.com", "https://boards.example.com"]);
    expect(originAllowed(request("POST", { origin: "http://boards.example.com" }))).toBe(true);
    expect(originAllowed(request("POST", { origin: "https://boards.example.com" }))).toBe(true);
  });

  it("refuses another origin, including a same-site sibling", () => {
    // `SameSite=Lax` does not separate boards.example.com from docs.example.com.
    expect(originAllowed(request("POST", { origin: "https://docs.example.com" }))).toBe(false);
    expect(csrfProblem(request("POST", { origin: "https://evil.example" }))).toBe("ORIGIN_NOT_ALLOWED");
    expect(originAllowed(request("POST", { origin: "not a url" }))).toBe(false);
  });

  it("lets a non-browser client through: there is no ambient cookie to forge", () => {
    expect(csrfProblem(request("POST"))).toBeNull();
  });

  it("requires the double-submit pair once a session cookie is carried", () => {
    const cookie = "remo_session=abc";
    expect(csrfProblem(request("POST", { origin: "http://boards.example.com", cookie }))).toBe(
      "CSRF_TOKEN_MISSING",
    );
    expect(
      csrfProblem(
        request("POST", {
          origin: "http://boards.example.com",
          cookie: `${cookie}; remo_csrf=token`,
        }),
      ),
    ).toBe("CSRF_TOKEN_MISSING");
    expect(
      csrfProblem(
        request("POST", {
          origin: "http://boards.example.com",
          cookie: `${cookie}; remo_csrf=token`,
          "x-csrf-token": "other",
        }),
      ),
    ).toBe("CSRF_TOKEN_INVALID");
    expect(
      csrfProblem(
        request("POST", {
          origin: "http://boards.example.com",
          cookie: `${cookie}; remo_csrf=token`,
          "x-csrf-token": "token",
        }),
      ),
    ).toBeNull();
  });

  it("protects the public-link unlock cookie the same way", () => {
    expect(
      csrfProblem(
        request("POST", {
          origin: "http://boards.example.com",
          cookie: "remo_link_unlock=unlocked; remo_csrf=token",
          "x-csrf-token": "wrong",
        }),
      ),
    ).toBe("CSRF_TOKEN_INVALID");
  });

  it("does not demand a token for an unauthenticated sign-in", () => {
    // Login CSRF is covered by the Origin check; there is no session to protect yet.
    expect(
      csrfProblem(request("POST", { origin: "http://boards.example.com", cookie: "remo_csrf=token" })),
    ).toBeNull();
  });
});
