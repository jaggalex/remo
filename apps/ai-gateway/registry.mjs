/**
 * The provider registry (`spec/ai-gateway.md` §4.1).
 *
 * The registry is the allow-list: a provider id or a user base URL is accepted only when
 * it appears here, and a model is accepted only when one of the provider's patterns
 * matches. Nothing outside the file is reachable, which is the point of the gateway.
 *
 * Loading is total: `validateConfig` either returns a completely normalised config or
 * throws `ConfigError`. A reload keeps the previous object on any error, so a broken
 * edit never leaves the gateway with half a registry.
 */
import { readFileSync } from "node:fs";

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REGIONS = new Set(["ru", "eu"]);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/** A request refused by the registry; the server turns it into an HTTP error. */
export class PolicyError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.status = status;
  }
}

function fail(message) {
  throw new ConfigError(message);
}

function integer(value, field, { fallback, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    fail(`${field} is required`);
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function amount(value, field, { fallback = 0, min = 0 } = {}) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    fail(`${field} must be a number >= ${min}`);
  }
  return value;
}

function boolean(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`${field} must be a boolean`);
  return value;
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function stringList(value, field, { fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Array.isArray(value) || !value.length) fail(`${field} must be a non-empty array`);
  return value.map((entry, index) => text(entry, `${field}[${index}]`));
}

/**
 * A base URL in the one form comparisons use: HTTPS, no credentials, the host in lower
 * case and no trailing slash. The path is preserved because providers differ in it.
 */
export function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    fail(`"${value}" is not a valid URL`);
  }
  if (url.protocol !== "https:") fail(`"${value}" must use HTTPS`);
  if (url.username || url.password) fail(`"${value}" must not contain credentials`);
  if (url.search || url.hash) fail(`"${value}" must not contain a query or fragment`);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/** `host:port`, with optional IPv6 brackets. Port 0 is allowed for tests and systemd sockets. */
export function parseHostPort(value, field = "address") {
  const raw = text(value, field);
  let host;
  let portText;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end < 0 || raw[end + 1] !== ":") fail(`${field} must be [host]:port`);
    host = raw.slice(1, end);
    portText = raw.slice(end + 2);
  } else {
    const split = raw.lastIndexOf(":");
    if (split <= 0) fail(`${field} must be host:port`);
    host = raw.slice(0, split);
    portText = raw.slice(split + 1);
  }
  if (!host) fail(`${field} has no host`);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`${field} has an invalid port`);
  return { host, port };
}

export function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** True when `model` is an exact entry or matches a pattern with a trailing `*`. */
export function modelMatches(models, model) {
  const wanted = String(model ?? "");
  if (!wanted) return false;
  return models.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) return wanted.startsWith(pattern.slice(0, -1));
    return pattern === wanted;
  });
}

function validateProvider(raw, index, { region }) {
  const field = `providers[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${field} must be an object`);
  const id = text(raw.id, `${field}.id`);
  if (!PROVIDER_ID.test(id)) fail(`${field}.id is not a valid provider id`);

  const baseUrl = normalizeBaseUrl(raw.baseUrl);
  const match =
    raw.match === undefined
      ? [baseUrl]
      : stringList(raw.match, `${field}.match`, { fallback: [baseUrl] }).map(normalizeBaseUrl);

  const models = stringList(raw.models, `${field}.models`, { fallback: ["*"] });
  const regions =
    raw.regions === undefined
      ? [region]
      : stringList(raw.regions, `${field}.regions`, { fallback: [region] });
  for (const entry of regions) {
    if (!REGIONS.has(entry)) fail(`${field}.regions contains an unknown region "${entry}"`);
  }

  let keyEnv = null;
  if (raw.keyEnv !== undefined && raw.keyEnv !== null) {
    keyEnv = text(raw.keyEnv, `${field}.keyEnv`);
    if (!ENV_NAME.test(keyEnv)) fail(`${field}.keyEnv must be an environment variable name`);
  }

  const price = raw.price ?? {};
  if (!price || typeof price !== "object" || Array.isArray(price)) fail(`${field}.price must be an object`);

  return {
    id,
    baseUrl,
    match,
    models,
    regions,
    timeoutMs: integer(raw.timeoutMs, `${field}.timeoutMs`, {
      fallback: 60_000,
      min: 1,
      max: 600_000,
    }),
    rpm: integer(raw.rpm, `${field}.rpm`, { fallback: 60, min: 1 }),
    byok: boolean(raw.byok, `${field}.byok`, false),
    keyEnv,
    price: {
      inPerMTok: amount(price.inPerMTok, `${field}.price.inPerMTok`),
      outPerMTok: amount(price.outPerMTok, `${field}.price.outPerMTok`),
    },
    enabled: boolean(raw.enabled, `${field}.enabled`, true),
  };
}

/** Validate raw JSON and return the normal form every other module uses. */
export function validateConfig(raw, { env = process.env } = {}) {
  void env;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("config must be an object");
  const region = raw.region;
  if (!REGIONS.has(region)) fail('region must be "ru" or "eu"');

  const listen = text(raw.listen, "listen");
  const admin = text(raw.admin, "admin");
  const listenAddr = parseHostPort(listen, "listen");
  const adminAddr = parseHostPort(admin, "admin");
  if (!isLoopbackHost(adminAddr.host)) fail("admin must listen on a loopback address");

  const limitRaw = raw.limits ?? {};
  if (!limitRaw || typeof limitRaw !== "object" || Array.isArray(limitRaw)) fail("limits must be an object");
  const perOrgRaw = limitRaw.perOrg ?? {};
  const perUserRaw = limitRaw.perUser ?? {};
  const globalRaw = limitRaw.global ?? {};
  const limits = {
    concurrency: integer(limitRaw.concurrency, "limits.concurrency", { fallback: 32, min: 1 }),
    perOrg: {
      rpm: integer(perOrgRaw.rpm, "limits.perOrg.rpm", { fallback: 30, min: 1 }),
      tokensPerDay: integer(perOrgRaw.tokensPerDay, "limits.perOrg.tokensPerDay", {
        fallback: 2_000_000,
        min: 1,
      }),
    },
    perUser: {
      rpm: integer(perUserRaw.rpm, "limits.perUser.rpm", { fallback: 15, min: 1 }),
      tokensPerDay: integer(perUserRaw.tokensPerDay, "limits.perUser.tokensPerDay", {
        fallback: 500_000,
        min: 1,
      }),
    },
    global: {
      rpm: integer(globalRaw.rpm, "limits.global.rpm", { fallback: 600, min: 1 }),
      costPerDay:
        globalRaw.costPerDay === undefined
          ? null
          : amount(globalRaw.costPerDay, "limits.global.costPerDay", { min: 0 }),
    },
  };

  if (!Array.isArray(raw.providers) || !raw.providers.length) {
    fail("providers must be a non-empty array");
  }
  const seen = new Set();
  const providers = raw.providers.map((entry, index) => {
    const provider = validateProvider(entry, index, { region });
    if (seen.has(provider.id)) fail(`provider id "${provider.id}" is repeated`);
    seen.add(provider.id);
    return provider;
  });

  return { region, listen, admin, listenAddr, adminAddr, limits, providers };
}

/** Read and validate one file. Errors are `ConfigError`s the caller can show to an operator. */
export function loadConfig(path, { env = process.env } = {}) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${error.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${error.message}`);
  }
  return validateConfig(raw, { env });
}

export function providerById(config, id) {
  return config.providers.find((provider) => provider.id === id) ?? null;
}

/** A provider whose `match` (or own `baseUrl`) equals this normalised base URL. */
export function providerByBaseUrl(config, baseUrl) {
  let normalized;
  try {
    normalized = normalizeBaseUrl(baseUrl);
  } catch {
    return null;
  }
  return (
    config.providers.find(
      (provider) => provider.match.includes(normalized) || provider.baseUrl === normalized,
    ) ?? null
  );
}

/** `X-Remo-Upstream` carries either a registry id or a user base URL (BYOK). */
export function providerForUpstream(config, upstream) {
  if (upstream == null || upstream === "") return null;
  const value = String(upstream);
  return providerById(config, value) ?? providerByBaseUrl(config, value);
}

/**
 * The registry as the running service sees it. `reload` is the only mutator and it is
 * deliberately atomic: on a bad file the previous config stays in place.
 */
export class Registry {
  constructor({ path = null, config = null, env = process.env, logger = console } = {}) {
    this.path = path;
    this.env = env;
    this.logger = logger;
    this._config = config ? validateConfig(config, { env }) : null;
  }

  get config() {
    if (!this._config) throw new ConfigError("the registry is not loaded");
    return this._config;
  }

  load() {
    if (!this.path) throw new ConfigError("the registry has no config path");
    this._config = loadConfig(this.path, { env: this.env });
    return this._config;
  }

  /** Return `{ok, config}` or `{ok:false, error}` while keeping the current config. */
  reload() {
    try {
      const next = this.path ? loadConfig(this.path, { env: this.env }) : this._config;
      if (!next) throw new ConfigError("the registry has no config to reload");
      this._config = next;
      return { ok: true, config: next };
    } catch (error) {
      this.logger.error?.(`config reload failed, keeping the previous config: ${error.message}`);
      return { ok: false, error };
    }
  }

  provider(id) {
    return providerById(this.config, id);
  }

  /** The provider for `X-Remo-Upstream`, or a `PolicyError` explaining the refusal. */
  resolve(upstream, { model, region, hasHeaderKey = false } = {}) {
    const provider = providerForUpstream(this.config, upstream);
    if (!provider) {
      throw new PolicyError(
        "PROVIDER_NOT_ALLOWED",
        "This provider is not allowed on this server",
      );
    }
    if (!modelMatches(provider.models, model)) {
      throw new PolicyError("PROVIDER_NOT_ALLOWED", "This model is not allowed on this server");
    }
    if (!provider.regions.includes(region)) {
      throw new PolicyError(
        "REGION_NOT_ALLOWED",
        "This provider is not allowed for this installation's region",
      );
    }
    if (hasHeaderKey && !provider.byok) {
      throw new PolicyError(
        "PROVIDER_NOT_ALLOWED",
        "This provider does not accept user keys on this server",
      );
    }
    return provider;
  }

  /** The provider a user base URL would be saved under, or null. */
  checkBaseUrl(baseUrl) {
    return providerByBaseUrl(this.config, baseUrl);
  }

  /** The installation key from `keyEnv`, or an empty string. */
  installationKey(provider) {
    if (!provider.keyEnv) return "";
    return this.env[provider.keyEnv] ?? "";
  }
}
