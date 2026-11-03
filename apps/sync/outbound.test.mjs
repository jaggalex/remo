import { EventEmitter } from "node:events";
import { createServer, request as httpsRequest } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNotRedirect, resolvePublicAddress, safeFetchWith } from "./outbound.mjs";

/** Minimal https.request stand-in: records the config and answers with one status. */
function transport(status, body = "", captured = []) {
  const request = (config, onResponse) => {
    captured.push(config);
    const req = new EventEmitter();
    req.write = () => true;
    req.end = () => {
      const response = new EventEmitter();
      response.statusCode = status;
      onResponse(response);
      queueMicrotask(() => {
        if (body) response.emit("data", Buffer.from(body));
        response.emit("end");
      });
    };
    req.destroy = (error) => {
      if (error) req.emit("error", error);
    };
    return req;
  };
  return { request, captured };
}

describe("outbound requests", () => {
  it("refuses private literal hosts before any connection", async () => {
    for (const host of ["127.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254"]) {
      await expect(resolvePublicAddress(host)).rejects.toMatchObject({ code: "PRIVATE_HOST" });
    }
  });

  it("resolves a public literal and pins that address in the socket lookup", async () => {
    const { request, captured } = transport(200, '{"ok":true}');
    const answer = await safeFetchWith(request, "https://1.1.1.1/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer k" },
    });
    expect(answer.ok).toBe(true);
    expect(await answer.json()).toEqual({ ok: true });

    const config = captured[0];
    expect(config.hostname).toBe("1.1.1.1");
    // The connection callback answers with the verified address, not a fresh lookup.
    const pinned = await new Promise((resolve, reject) => {
      config.lookup("1.1.1.1", {}, (error, address, family) =>
        error ? reject(error) : resolve({ address, family }),
      );
    });
    expect(pinned).toEqual({ address: "1.1.1.1", family: 4 });

    const all = await new Promise((resolve, reject) => {
      config.lookup("1.1.1.1", { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      );
    });
    expect(all).toEqual([{ address: "1.1.1.1", family: 4 }]);
  });

  it("works through the real Node HTTPS transport with an { all: true } lookup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "remo-outbound-"));
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    try {
      execFileSync(
        "openssl",
        ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"],
        { stdio: "ignore" },
      );
    } catch {
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    const server = createServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (_request, response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ok":true}');
      },
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const answer = await safeFetchWith(
        (config, callback) => httpsRequest({ ...config, rejectUnauthorized: false }, callback),
        `https://localhost:${port}/health`,
        { allowPrivate: true },
      );
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ ok: true });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a redirect instead of following it", async () => {
    expect(() => assertNotRedirect(302)).toThrow(
      expect.objectContaining({ code: "REDIRECT_REFUSED" }),
    );
    const { request } = transport(302);
    await expect(safeFetchWith(request, "https://1.1.1.1/v1/chat", {})).rejects.toMatchObject({
      code: "REDIRECT_REFUSED",
    });
  });

  it("refuses plain HTTP and credentials in the URL", async () => {
    const { request } = transport(200);
    await expect(safeFetchWith(request, "http://1.1.1.1/v1", {})).rejects.toMatchObject({
      code: "BAD_URL",
    });
    await expect(
      safeFetchWith(request, "https://user:pass@1.1.1.1/v1", {}),
    ).rejects.toMatchObject({ code: "BAD_URL" });
  });
});
