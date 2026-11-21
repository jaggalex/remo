/**
 * The gateway's HTTP surface (`spec/ai-gateway.md` §3, §5).
 *
 * One ingress route, one BYOK check route, health and metrics. The order is the one the
 * spec fixes: auth, parse, provider, kill switches, limits, call, account, log. Only this
 * process talks to providers, so the family of `X-Remo-*` headers ends here and the
 * provider sees `Authorization`, `Content-Type` and `X-Title` alone.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_BODY, OutboundError, safeFetch } from "@remo/outbound";
import { createAdminServer } from "./admin.mjs";
import { Limits } from "./limits.mjs";
import { AdminLog, MetadataLog, sanitize } from "./log.mjs";
import { GatewayMetrics } from "./metrics.mjs";
import { PolicyError, Registry } from "./registry.mjs";
import { StateStore } from "./state.mjs";

export const VERSION = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

class BodyTooLarge extends Error {
  constructor() {
    super("request body is larger than the gateway accepts");
    this.status = 413;
    this.code = "REQUEST_TOO_LARGE";
  }
}

/** Compare two secrets without leaking their length or a position of the first difference. */
export function constantTimeEqual(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}

export function bearerToken(header) {
  if (typeof header !== "string") return "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

export function errorBody(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : typeof value === "string" ? value : "";
}

function requestId(value) {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text === "string" && text.length > 0 && text.length <= 200 && !/[\u0000-\u001f\u007f]/.test(text)) {
    return text;
  }
  return randomUUID();
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        req.resume();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.on("aborted", () => {
      if (settled) return;
      settled = true;
      reject(new Error("the client closed before sending the body"));
    });
  });
}

function readUsage(payload) {
  const usage = payload && typeof payload === "object" ? payload.usage : null;
  const number = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
  if (!usage || typeof usage !== "object") return { input: 0, output: 0 };
  return {
    input: number(usage.prompt_tokens ?? usage.input_tokens),
    output: number(usage.completion_tokens ?? usage.output_tokens),
  };
}

function priced(provider, input, output) {
  const inCost = (input / 1_000_000) * provider.price.inPerMTok;
  const outCost = (output / 1_000_000) * provider.price.outPerMTok;
  return inCost + outCost;
}

function withDefaultType(headers, fallback) {
  return headers["content-type"] ? headers : { ...headers, "content-type": fallback };
}

function sendJson(res, status, payload, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, withDefaultType(headers, "application/json; charset=utf-8"));
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, withDefaultType(headers, "text/plain; charset=utf-8"));
  res.end(text);
}

function listenOn(server, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(address.port, address.host);
  });
}

function closeServer(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Build a gateway without starting it. Tests use this with a temporary state directory;
 * `main` uses it with the paths from the environment.
 */
export async function createGateway({
  configPath = null,
  config = null,
  stateDir = null,
  stateFile = null,
  token,
  adminToken = null,
  metricsToken = null,
  env = process.env,
  now = () => Date.now(),
  clock = null,
  fetchImpl = safeFetch,
  logger = console,
  busyWaitMs = 2000,
  adminEnabled = true,
  tls = null,
} = {}) {
  if (!token) throw new Error("a gateway token is required");
  if (adminEnabled && !adminToken) throw new Error("an admin token is required when the admin API is enabled");

  const registry = new Registry({ path: configPath, config, env, logger });
  if (configPath && !config) registry.load();
  const configNow = registry.config;

  const dir = stateDir ?? (stateFile ? dirname(stateFile) : process.cwd());
  const file = stateFile ?? join(dir, "state.json");
  const dateClock = clock ?? (() => new Date(now()));

  const state = new StateStore(file, { now: dateClock, logger, autosaveMs: 60_000 });
  await state.load();
  const requestLog = new MetadataLog({ dir, clock: dateClock, logger });
  const adminLog = new AdminLog({ dir, clock: dateClock, logger });
  const metrics = new GatewayMetrics({ logger });
  metrics.inflight(0);
  const limits = new Limits({ state, config: configNow, now, busyWaitMs });
  const startedAt = now();

  const gateway = {
    version: VERSION,
    registry,
    state,
    limits,
    metrics,
    requestLog,
    adminLog,
    startedAt,
    get config() {
      return registry.config;
    },
  };

  async function handleChat(req, res) {
    const started = now();
    const entry = {
      ts: new Date(started).toISOString(),
      rid: requestId(req.headers["x-request-id"]),
      org: "",
      user: "",
      task: "",
      provider: "",
      model: "",
      status: 0,
      code: null,
      latencyMs: 0,
      in: 0,
      out: 0,
      cost: 0,
    };
    let release = null;
    let killScope = null;
    let rateScope = null;
    let upstreamCalled = false;
    let finished = false;

    const finish = async (status, payload, { code = null, headers = {} } = {}) => {
      if (finished) return;
      finished = true;
      entry.status = status;
      entry.code = code;
      entry.latencyMs = Math.max(0, Math.round(now() - started));
      metrics.request({ provider: entry.provider || "-", model: entry.model || "-", status });
      if (code === "KILLED" && killScope) metrics.killed(killScope);
      if (code === "RATE_LIMITED" && rateScope) metrics.rateLimited(rateScope);
      if (upstreamCalled && entry.provider) metrics.latency(entry.provider, entry.latencyMs / 1000);
      // Logging before the answer keeps the journal deterministic for a caller that reads
      // it immediately after the response.
      await requestLog.write(entry);
      if (release) {
        release();
        release = null;
        metrics.inflight(limits.inflight);
      }
      if (res.headersSent) return;
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      res.writeHead(status, withDefaultType(headers, "application/json; charset=utf-8"));
      res.end(body);
    };

    try {
      if (!constantTimeEqual(token, bearerToken(req.headers.authorization))) {
        return await finish(401, errorBody("GATEWAY_AUTH", "The gateway token is not valid"), {
          code: "GATEWAY_AUTH",
        });
      }

      let rawBody;
      try {
        rawBody = await readBody(req, MAX_BODY);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          return await finish(413, errorBody("REQUEST_TOO_LARGE", error.message), {
            code: "REQUEST_TOO_LARGE",
          });
        }
        throw error;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return await finish(400, errorBody("INVALID_REQUEST", "The body must be JSON"), {
          code: "INVALID_REQUEST",
        });
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof payload.model !== "string" ||
        !payload.model ||
        !Array.isArray(payload.messages)
      ) {
        return await finish(
          400,
          errorBody("INVALID_REQUEST", "The body must contain model and messages"),
          { code: "INVALID_REQUEST" },
        );
      }

      entry.model = payload.model.slice(0, 200);
      entry.org = headerValue(req, "x-remo-org").slice(0, 200);
      entry.user = headerValue(req, "x-remo-user").slice(0, 200);
      entry.task = headerValue(req, "x-remo-task").slice(0, 200);

      const upstream = headerValue(req, "x-remo-upstream").slice(0, 500);
      const headerKey = headerValue(req, "x-remo-upstream-key").slice(0, 1000);
      const regionHeader = headerValue(req, "x-remo-region").slice(0, 16);
      const region = (regionHeader || registry.config.region).toLowerCase();

      let provider;
      try {
        provider = registry.resolve(upstream, {
          model: payload.model,
          region,
          hasHeaderKey: Boolean(headerKey),
        });
      } catch (error) {
        if (error instanceof PolicyError) {
          return await finish(error.status, errorBody(error.code, error.message), {
            code: error.code,
          });
        }
        throw error;
      }
      entry.provider = provider.id;

      const key = headerKey || registry.installationKey(provider);
      if (!key) {
        return await finish(
          403,
          errorBody("PROVIDER_NOT_ALLOWED", "No provider key is configured for this provider"),
          { code: "PROVIDER_NOT_ALLOWED" },
        );
      }

      // The order is part of the contract: the broadest switch answers first.
      const scopes = [
        ["global", null],
        ["provider", provider.id],
        ["org", entry.org],
        ["user", entry.user],
      ];
      for (const [scope, id] of scopes) {
        const killed = state.killInfo(scope, id);
        if (!killed) continue;
        killScope = scope;
        const extra = { scope, ...(killed.reason ? { reason: killed.reason } : {}) };
        return await finish(
          423,
          errorBody("KILLED", killed.reason || "AI is temporarily unavailable", extra),
          { code: "KILLED" },
        );
      }
      if (!provider.enabled) {
        killScope = "provider";
        return await finish(
          423,
          errorBody("KILLED", "This provider is disabled", { scope: "provider" }),
          { code: "KILLED" },
        );
      }

      const rate = limits.checkRate({
        provider,
        org: entry.org || "unknown",
        user: entry.user || "unknown",
      });
      if (!rate.ok) {
        rateScope = rate.scope;
        return await finish(
          429,
          errorBody("RATE_LIMITED", "Too many AI requests, try again later", {
            scope: rate.scope,
            retryAfter: rate.retryAfter,
          }),
          { code: "RATE_LIMITED", headers: { "retry-after": String(rate.retryAfter) } },
        );
      }
      const daily = limits.checkDaily({
        org: entry.org || "unknown",
        user: entry.user || "unknown",
      });
      if (!daily.ok) {
        rateScope = daily.scope;
        return await finish(
          429,
          errorBody("RATE_LIMITED", "The daily AI token budget is exhausted", {
            scope: daily.scope,
            retryAfter: daily.retryAfter,
          }),
          { code: "RATE_LIMITED", headers: { "retry-after": String(daily.retryAfter) } },
        );
      }
      const cost = limits.checkCost();
      if (!cost.ok) {
        rateScope = cost.scope;
        return await finish(
          429,
          errorBody("RATE_LIMITED", "The daily AI spend budget is exhausted", {
            scope: cost.scope,
            retryAfter: cost.retryAfter,
          }),
          { code: "RATE_LIMITED", headers: { "retry-after": String(cost.retryAfter) } },
        );
      }

      release = await limits.acquire();
      if (!release) {
        return await finish(503, errorBody("GATEWAY_BUSY", "The AI gateway is overloaded"), {
          code: "GATEWAY_BUSY",
        });
      }
      metrics.inflight(limits.inflight);

      const providerHeaders = (extra = {}) => ({
        "x-remo-gateway-provider": provider.id,
        "x-remo-gateway-latency-ms": String(Math.max(0, Math.round(now() - started))),
        ...extra,
      });

      upstreamCalled = true;
      const target = `${provider.baseUrl}/chat/completions`;
      let answer;
      try {
        answer = await fetchImpl(target, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            "x-title": "remo",
          },
          body: rawBody,
          timeoutMs: provider.timeoutMs,
        });
      } catch (error) {
        const code = error instanceof OutboundError ? error.code : error?.code;
        const timedOut =
          code === "TIMEOUT" || code === "ABORTED" || error?.name === "TimeoutError" || error?.name === "AbortError";
        if (timedOut) {
          metrics.upstreamError(provider.id, "TIMEOUT");
          return await finish(
            504,
            errorBody("UPSTREAM_TIMEOUT", "The model provider did not answer in time"),
            { code: "UPSTREAM_TIMEOUT", headers: providerHeaders() },
          );
        }
        logger.error?.(`upstream ${provider.id} failed: ${sanitize(error?.message ?? error, 200)}`);
        metrics.upstreamError(provider.id, code || "NETWORK");
        return await finish(
          502,
          errorBody("UPSTREAM_ERROR", "The model provider could not be reached", {
            upstreamStatus: 0,
          }),
          { code: "UPSTREAM_ERROR", headers: providerHeaders() },
        );
      }

      if (!answer.ok) {
        // Drain the body so the connection can be reused, but never keep or log it.
        try {
          await answer.text?.();
        } catch {
          // The status is all this path needs.
        }
        metrics.upstreamError(provider.id, answer.status);
        return await finish(
          502,
          errorBody("UPSTREAM_ERROR", "The model provider returned an error", {
            upstreamStatus: answer.status,
          }),
          { code: "UPSTREAM_ERROR", headers: providerHeaders() },
        );
      }

      const text = await answer.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const usage = readUsage(parsed);
      const costValue = priced(provider, usage.input, usage.output);
      entry.in = usage.input;
      entry.out = usage.output;
      entry.cost = costValue;
      state.addUsage({
        org: entry.org,
        user: entry.user,
        tokens: usage.input + usage.output,
        cost: costValue,
      });
      metrics.tokens(provider.id, "in", usage.input);
      metrics.tokens(provider.id, "out", usage.output);
      metrics.cost(provider.id, costValue);

      return await finish(answer.status, text, {
        code: null,
        headers: providerHeaders({
          "x-remo-gateway-usage": `in=${usage.input},out=${usage.output}`,
          "content-type": parsed
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8",
        }),
      });
    } catch (error) {
      logger.error?.(`gateway request failed: ${sanitize(error?.message ?? error, 300)}`);
      return await finish(500, errorBody("INTERNAL", "The gateway failed to handle this request"), {
        code: "INTERNAL",
      });
    }
  }

  async function handleCheck(req, res) {
    if (!constantTimeEqual(token, bearerToken(req.headers.authorization))) {
      return sendJson(res, 401, errorBody("GATEWAY_AUTH", "The gateway token is not valid"));
    }
    const url = new URL(req.url, "http://gateway");
    const baseUrl = url.searchParams.get("baseUrl");
    if (!baseUrl) {
      return sendJson(res, 400, errorBody("INVALID_REQUEST", "baseUrl is required"));
    }
    const provider = registry.checkBaseUrl(baseUrl);
    if (!provider) {
      return sendJson(
        res,
        403,
        errorBody("PROVIDER_NOT_ALLOWED", "This provider is not allowed on this server"),
      );
    }
    return sendJson(res, 200, { allowed: true, provider: provider.id });
  }

  function handleMetrics(req, res) {
    if (!metricsToken) return sendText(res, 404, "not found");
    const url = new URL(req.url, "http://gateway");
    const provided = bearerToken(req.headers.authorization) || url.searchParams.get("token") || "";
    if (!constantTimeEqual(metricsToken, provided)) return sendText(res, 404, "not found");
    return sendText(res, 200, metrics.render(), {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    });
  }

  const handler = (req, res) => {
    const fail = (error) => {
      logger.error?.(`gateway route failed: ${sanitize(error?.message ?? error, 300)}`);
      sendJson(res, 500, errorBody("INTERNAL", "The gateway failed to handle this request"));
    };
    try {
      const url = new URL(req.url, "http://gateway");
      if (req.method === "GET" && url.pathname === "/healthz") {
        return sendJson(res, 200, { status: "ok" });
      }
      if (req.method === "GET" && url.pathname === "/metrics") {
        return handleMetrics(req, res);
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        void handleChat(req, res).catch(fail);
        return undefined;
      }
      if (req.method === "GET" && url.pathname === "/v1/upstreams/check") {
        void handleCheck(req, res).catch(fail);
        return undefined;
      }
      return sendJson(res, 404, errorBody("NOT_FOUND", "No such route"));
    } catch (error) {
      return fail(error);
    }
  };
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);

  gateway.server = server;
  gateway.adminServer =
    adminEnabled && adminToken
      ? createAdminServer(gateway, {
          authorize: (req) =>
            constantTimeEqual(adminToken, bearerToken(req.headers.authorization)),
          logger,
        })
      : null;

  gateway.reload = () => {
    const result = registry.reload();
    if (result.ok) limits.setConfig(result.config);
    return result;
  };

  gateway.providerTest = async (id, model = null) => {
    const provider = registry.provider(id);
    if (!provider) return { ok: false, status: 404, error: "unknown provider" };
    const key = registry.installationKey(provider);
    if (!key) return { ok: false, status: 0, error: "no installation key is configured" };
    const chosen = model || provider.models.find((entry) => !entry.includes("*")) || "test";
    const started = now();
    try {
      const answer = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "x-title": "remo",
        },
        body: JSON.stringify({
          model: chosen,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        timeoutMs: provider.timeoutMs,
      });
      const text = await answer.text().catch(() => "");
      return {
        ok: answer.ok,
        status: answer.status,
        latencyMs: Math.max(0, Math.round(now() - started)),
        preview: answer.ok ? sanitize(text, 200) : null,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        latencyMs: Math.max(0, Math.round(now() - started)),
        error: sanitize(error?.message ?? error, 200),
        code: error?.code ?? null,
      };
    }
  };

  gateway.start = async () => {
    await listenOn(server, registry.config.listenAddr);
    if (gateway.adminServer) await listenOn(gateway.adminServer, registry.config.adminAddr);
    return gateway;
  };

  gateway.close = async () => {
    await closeServer(gateway.adminServer);
    await closeServer(server);
    await state.stop();
  };

  gateway.address = () => server.address();

  return gateway;
}

function adminTokenFromEnv(env) {
  if (env.GATEWAY_ADMIN_TOKEN) return env.GATEWAY_ADMIN_TOKEN;
  const file = env.GATEWAY_ADMIN_TOKEN_FILE ?? "/etc/remo-ai-gateway/admin.token";
  return readFileSync(file, "utf8").trim();
}

export async function main() {
  const token = process.env.GATEWAY_TOKEN;
  if (!token) throw new Error("GATEWAY_TOKEN is required");
  const configPath = process.env.GATEWAY_CONFIG ?? "/etc/remo-ai-gateway/config.json";
  const stateDir = process.env.GATEWAY_STATE_DIR ?? "/var/lib/remo-ai-gateway";
  const certFile = process.env.GATEWAY_TLS_CERT;
  const keyFile = process.env.GATEWAY_TLS_KEY;
  const tls =
    certFile && keyFile
      ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
      : null;
  const gateway = await createGateway({
    configPath,
    stateDir,
    token,
    adminToken: adminTokenFromEnv(process.env),
    metricsToken: process.env.GATEWAY_METRICS_TOKEN ?? null,
    tls,
  });
  await gateway.start();

  const address = gateway.address();
  console.log(
    `remo-ai-gateway ${VERSION} listening on ${address.address}:${address.port} (region ${gateway.config.region})`,
  );

  const flush = setInterval(() => void gateway.state.flush(), 60_000);
  flush.unref();
  process.on("SIGHUP", () => {
    const result = gateway.reload();
    if (result.ok) console.log("config reloaded");
  });

  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    clearInterval(flush);
    await gateway.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return gateway;
}

const isMain =
  process.argv[1] &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
      return false;
    }
  })();
if (isMain) {
  main().catch((error) => {
    console.error(`remo-ai-gateway failed to start: ${error.message}`);
    process.exit(1);
  });
}
