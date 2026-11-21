/**
 * The operator API on `127.0.0.1` (`spec/ai-gateway.md` §4.3).
 *
 * It is a thin layer over the same state, registry and limits the request path uses, so
 * `remo-gw kill` takes effect on the next call without a restart and without a second
 * source of truth. Every mutating action lands in `admin.log`.
 */
import { createServer } from "node:http";
import { usageFromLogs } from "./log.mjs";

const BODY_LIMIT = 64 * 1024;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        settled = true;
        reject(new HttpError(413, "BODY_TOO_LARGE", "the admin body is too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "INVALID_REQUEST", "the admin body must be JSON"));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function requireOrg(body) {
  if (!body || typeof body.id !== "string" || !body.id.trim()) {
    throw new HttpError(400, "INVALID_REQUEST", "id is required");
  }
  return body.id.trim().slice(0, 200);
}

function assertScope(scope) {
  if (!["global", "provider", "org", "user"].includes(scope)) {
    throw new HttpError(400, "INVALID_REQUEST", "scope must be global, provider, org or user");
  }
  return scope;
}

async function appendAdminLog(gateway, req, action, { target = null, reason = null, params = null }) {
  await gateway.adminLog.append({
    action,
    actor: req.socket.remoteAddress ?? "local",
    target,
    reason,
    params,
  });
}

export function createAdminServer(gateway, { authorize, logger = console } = {}) {
  if (typeof authorize !== "function") throw new Error("the admin API needs an authorize function");

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      logger.error?.(`admin request failed: ${error.message}`);
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "INTERNAL";
      sendJson(res, status, { error: { code, message: error.message } });
    });
  });

  async function handle(req, res) {
    if (!authorize(req)) {
      return sendJson(res, 401, { error: { code: "ADMIN_AUTH", message: "invalid admin token" } });
    }
    const url = new URL(req.url, "http://admin");
    const path = url.pathname;

    if (req.method === "GET" && path === "/status") {
      const snapshot = gateway.state.snapshot();
      return sendJson(res, 200, {
        version: gateway.version,
        region: gateway.config.region,
        listen: gateway.config.listen,
        admin: gateway.config.admin,
        providers: gateway.config.providers.length,
        enabledProviders: gateway.config.providers.filter((provider) => provider.enabled).length,
        kills: snapshot.kill,
        inflight: gateway.limits.inflight,
        day: snapshot.usage.day,
        uptimeMs: Math.max(0, Date.now() - gateway.startedAt),
      });
    }

    if (req.method === "GET" && path === "/providers") {
      return sendJson(
        res,
        200,
        gateway.config.providers.map((provider) => ({
          id: provider.id,
          enabled: provider.enabled,
          regions: provider.regions,
          models: provider.models,
          rpm: provider.rpm,
          byok: provider.byok,
          hasInstallationKey: Boolean(provider.keyEnv),
          stats: gateway.metrics.providerStats(provider.id),
        })),
      );
    }

    const testMatch = /^\/providers\/([^/]+)\/test$/.exec(path);
    if (req.method === "POST" && testMatch) {
      const body = await readJson(req);
      const result = await gateway.providerTest(decodeURIComponent(testMatch[1]), body?.model ?? null);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && path === "/kill") {
      return sendJson(res, 200, gateway.state.snapshot().kill);
    }

    if (req.method === "POST" && path === "/kill") {
      const body = await readJson(req);
      const scope = assertScope(body?.scope);
      const id = scope === "global" ? null : requireOrg(body);
      const until = typeof body.until === "string" && body.until ? body.until : null;
      let kill;
      try {
        kill = gateway.state.setKill(scope, id, { reason: body.reason ?? "", until });
      } catch (error) {
        throw new HttpError(400, "INVALID_REQUEST", error.message);
      }
      await gateway.state.flush();
      await appendAdminLog(gateway, req, "kill", {
        target: scope === "global" ? "global" : `${scope}:${id}`,
        reason: body.reason ?? null,
        params: { until },
      });
      return sendJson(res, 200, { ok: true, scope, id, kill });
    }

    if (req.method === "POST" && path === "/unkill") {
      const body = await readJson(req);
      const scope = assertScope(body?.scope);
      const id = scope === "global" ? null : requireOrg(body);
      gateway.state.unsetKill(scope, id);
      await gateway.state.flush();
      await appendAdminLog(gateway, req, "unkill", {
        target: scope === "global" ? "global" : `${scope}:${id}`,
      });
      return sendJson(res, 200, { ok: true, scope, id });
    }

    if (req.method === "GET" && path === "/limits") {
      const snapshot = gateway.state.snapshot();
      return sendJson(res, 200, {
        limits: gateway.config.limits,
        overrides: snapshot.limitOverrides.org,
      });
    }

    if (req.method === "POST" && path === "/limits") {
      const body = await readJson(req);
      if (body?.scope !== "org") {
        throw new HttpError(400, "INVALID_REQUEST", "only org overrides are supported");
      }
      const id = requireOrg(body);
      let entry;
      try {
        entry = gateway.state.setLimitOverride(id, {
          rpm: body.rpm,
          tokensPerDay: body.tokensPerDay,
        });
      } catch (error) {
        throw new HttpError(400, "INVALID_REQUEST", error.message);
      }
      await gateway.state.flush();
      await appendAdminLog(gateway, req, "limits.set", {
        target: `org:${id}`,
        params: entry,
      });
      return sendJson(res, 200, { ok: true, org: id, override: entry });
    }

    if (req.method === "POST" && path === "/limits/clear") {
      const body = await readJson(req);
      if (body?.scope !== "org") {
        throw new HttpError(400, "INVALID_REQUEST", "only org overrides are supported");
      }
      const id = requireOrg(body);
      gateway.state.clearLimitOverride(id);
      await gateway.state.flush();
      await appendAdminLog(gateway, req, "limits.clear", { target: `org:${id}` });
      return sendJson(res, 200, { ok: true, org: id });
    }

    if (req.method === "GET" && path === "/usage") {
      const snapshot = gateway.state.snapshot();
      const day = url.searchParams.get("day") || snapshot.usage.day;
      const org = url.searchParams.get("org") || null;
      if (day === snapshot.usage.day) {
        const tokens = org
          ? (snapshot.usage.org[org] ?? 0)
          : Object.values(snapshot.usage.org).reduce((total, value) => total + value, 0);
        const cost = org ? (snapshot.usage.cost.org[org] ?? 0) : snapshot.usage.cost.global;
        return sendJson(res, 200, { day, org, tokens, cost });
      }
      const usage = await usageFromLogs({ dir: gateway.requestLog.dir, day, org });
      return sendJson(res, 200, usage);
    }

    if (req.method === "POST" && path === "/reload") {
      const result = gateway.reload();
      await appendAdminLog(gateway, req, "reload", {
        params: { ok: result.ok },
        reason: result.ok ? null : result.error?.message ?? "reload failed",
      });
      if (!result.ok) {
        return sendJson(res, 500, {
          ok: false,
          error: { code: "CONFIG_INVALID", message: result.error.message },
        });
      }
      return sendJson(res, 200, {
        ok: true,
        providers: result.config.providers.map((provider) => provider.id),
      });
    }

    if (req.method === "GET" && path === "/tail") {
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const records = await gateway.requestLog.recent({
        limit,
        org: url.searchParams.get("org") || null,
        status: url.searchParams.get("status") || null,
      });
      return sendJson(res, 200, records);
    }

    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "no such admin route" } });
  }

  return server;
}
