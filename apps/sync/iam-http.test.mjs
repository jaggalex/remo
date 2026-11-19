import { describe, expect, it } from "vitest";
import { json } from "./iam-http.mjs";

/** The minimum of ServerResponse that `json` touches. */
function response() {
  const headers = {};
  return {
    headers,
    status: 0,
    body: "",
    getHeader(name) {
      return headers[name];
    },
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(status, extra = {}) {
      this.status = status;
      Object.assign(headers, extra);
    },
    end(body) {
      this.body = body;
    },
  };
}

describe("the JSON response helper", () => {
  it("keeps a cookie a handler already queued", () => {
    // A request may carry a CSRF cookie and a handler-set session cookie. Overwriting
    // `Set-Cookie` would drop one of them, and the CSRF pair would break (ADR-062).
    const res = response();
    res.setHeader("Set-Cookie", ["session=abc"]);
    json(res, 200, { ok: true }, { "Set-Cookie": "csrf=token" });

    expect(res.headers["Set-Cookie"]).toEqual(["session=abc", "csrf=token"]);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("sets the content type and does not invent a cookie", () => {
    const res = response();
    json(res, 204, { ok: true });
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["Set-Cookie"]).toBeUndefined();
  });
});
