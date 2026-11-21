#!/usr/bin/env node
/**
 * `remo-gw` — the operator CLI (`spec/ai-gateway.md` §4.3).
 *
 * It never touches state files directly: every command goes through the admin API on
 * loopback, so the running gateway remains the only writer and `admin.log` sees every
 * action. The token comes from the environment or the file the service reads.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_ADMIN = "http://127.0.0.1:8081";
const DEFAULT_TOKEN_FILE = "/etc/remo-ai-gateway/admin.token";

/** `30s`, `15m`, `2h`, `1d` into milliseconds. */
export function parseDuration(value) {
  const match = /^(\d+)([smhd])$/i.exec(String(value ?? "").trim());
  if (!match) throw new Error("--for must look like 30m, 2h or 1d");
  const amount = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
  return amount * unit;
}

function adminUrl() {
  return (process.env.GATEWAY_ADMIN_URL ?? process.env.REMO_GW_ADMIN_URL ?? DEFAULT_ADMIN).replace(
    /\/+$/,
    "",
  );
}

function adminToken() {
  if (process.env.GATEWAY_ADMIN_TOKEN) return process.env.GATEWAY_ADMIN_TOKEN;
  const file = process.env.GATEWAY_ADMIN_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    throw new Error(`cannot read the admin token from ${file} (set GATEWAY_ADMIN_TOKEN)`);
  }
}

async function call(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${adminUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.error?.code ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function flags(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[name] = next;
      index += 1;
    } else {
      options[name] = true;
    }
  }
  return { positional, options };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function table(rows, columns) {
  const widths = columns.map((column) =>
    Math.max(column.title.length, ...rows.map((row) => String(row[column.key] ?? "").length)),
  );
  const line = (cells) =>
    cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  console.log(line(columns.map((column) => column.title)));
  for (const row of rows) console.log(line(columns.map((column) => row[column.key])));
}

function targetOf(positional) {
  const scope = positional[0];
  if (!["global", "provider", "org", "user"].includes(scope)) {
    throw new Error("target must be global, provider <id>, org <id> or user <id>");
  }
  if (scope === "global") return { scope, id: null };
  if (!positional[1]) throw new Error(`${scope} needs an id`);
  return { scope, id: positional[1] };
}

async function commandStatus(options) {
  const status = await call("/status");
  if (options.json) return printJson(status);
  console.log(`remo-ai-gateway ${status.version}  region ${status.region}`);
  console.log(`listen ${status.listen}  admin ${status.admin}`);
  console.log(
    `providers ${status.enabledProviders}/${status.providers} enabled  inflight ${status.inflight}`,
  );
  console.log(`usage day ${status.day}`);
  const kills = [];
  if (status.kills.global?.on) kills.push("global");
  for (const scope of ["provider", "org", "user"]) {
    for (const [id, entry] of Object.entries(status.kills[scope] ?? {})) {
      if (entry.on) kills.push(`${scope}:${id}${entry.until ? ` until ${entry.until}` : ""}`);
    }
  }
  console.log(`kills ${kills.length ? kills.join(", ") : "none"}`);
}

async function commandProviders(positional, options) {
  if (positional[0] === "test") {
    const id = positional[1];
    if (!id) throw new Error("providers test needs a provider id");
    const result = await call(`/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: { model: options.model ?? null },
    });
    return options.json ? printJson(result) : console.log(JSON.stringify(result, null, 2));
  }
  const providers = await call("/providers");
  if (options.json) return printJson(providers);
  return table(
    providers.map((provider) => ({
      ...provider,
      regions: provider.regions.join(","),
      models: provider.models.join(","),
      errorsLastHour: provider.stats?.errorsLastHour ?? 0,
      p95Ms: provider.stats?.p95Ms ?? 0,
    })),
    [
      { key: "id", title: "id" },
      { key: "enabled", title: "enabled" },
      { key: "regions", title: "regions" },
      { key: "models", title: "models" },
      { key: "rpm", title: "rpm" },
      { key: "errorsLastHour", title: "errors/h" },
      { key: "p95Ms", title: "p95 ms" },
    ],
  );
}

async function commandKill(positional, options) {
  const { scope, id } = targetOf(positional);
  const until = options.for ? new Date(Date.now() + parseDuration(options.for)).toISOString() : null;
  const result = await call("/kill", {
    method: "POST",
    body: { scope, id, reason: options.reason ?? "", until },
  });
  if (options.json) return printJson(result);
  return console.log(`killed ${scope}${id ? ` ${id}` : ""}${until ? ` until ${until}` : ""}`);
}

async function commandUnkill(positional, options) {
  const { scope, id } = targetOf(positional);
  const result = await call("/unkill", { method: "POST", body: { scope, id } });
  if (options.json) return printJson(result);
  return console.log(`unkilled ${scope}${id ? ` ${id}` : ""}`);
}

async function commandLimits(positional, options) {
  if (positional[0] === "set") {
    if (positional[1] !== "org" || !positional[2]) {
      throw new Error("limits set org <id> --tokens-per-day N [--rpm N]");
    }
    const tokensPerDay = options["tokens-per-day"] ? Number(options["tokens-per-day"]) : undefined;
    const rpm = options.rpm ? Number(options.rpm) : undefined;
    const result = await call("/limits", {
      method: "POST",
      body: { scope: "org", id: positional[2], tokensPerDay, rpm },
    });
    return options.json ? printJson(result) : printJson(result.override);
  }
  if (positional[0] === "clear") {
    if (positional[1] !== "org" || !positional[2]) throw new Error("limits clear org <id>");
    const result = await call("/limits/clear", {
      method: "POST",
      body: { scope: "org", id: positional[2] },
    });
    return options.json ? printJson(result) : console.log(`cleared limits for org ${positional[2]}`);
  }
  const result = await call("/limits");
  if (options.json) return printJson(result);
  console.log("defaults:");
  console.log(JSON.stringify(result.limits, null, 2));
  console.log("overrides:");
  return printJson(result.overrides);
}

async function commandUsage(options) {
  const query = new URLSearchParams();
  if (options.org) query.set("org", options.org);
  if (options.day) query.set("day", options.day);
  const result = await call(`/usage?${query}`);
  if (options.json) return printJson(result);
  console.log(
    `${result.day}${result.org ? ` org ${result.org}` : ""}: ${result.tokens} tokens, cost ${Number(result.cost).toFixed(6)}`,
  );
}

async function commandReload(options) {
  const result = await call("/reload", { method: "POST" });
  if (options.json) return printJson(result);
  return console.log(`reloaded: ${result.providers.join(", ")}`);
}

function printRecord(record) {
  console.log(
    `${record.ts} ${record.status} ${record.provider}/${record.model} ${record.latencyMs}ms in=${record.in} out=${record.out} org=${record.org} user=${record.user} rid=${record.rid}${record.code ? ` ${record.code}` : ""}`,
  );
}

async function commandTail(options) {
  const query = new URLSearchParams({ limit: options.limit ?? "100" });
  if (options.org) query.set("org", options.org);
  if (options.status) query.set("status", options.status);
  const follow = options.follow ?? Boolean(process.stdout.isTTY);
  const seen = new Set();
  for (;;) {
    const records = await call(`/tail?${query}`);
    for (const record of records) {
      const key = `${record.ts}|${record.rid}|${record.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (options.json) printJson(record);
      else printRecord(record);
    }
    if (!follow) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main(argv) {
  const { positional, options } = flags(argv);
  const command = positional.shift();
  if (!command) {
    console.log(
      "usage: remo-gw status|providers [test <id>]|kill …|unkill …|limits …|usage|reload|tail [--follow]",
    );
    return;
  }
  if (command === "status") return commandStatus(options);
  if (command === "providers") return commandProviders(positional, options);
  if (command === "kill") return commandKill(positional, options);
  if (command === "unkill") return commandUnkill(positional, options);
  if (command === "limits") return commandLimits(positional, options);
  if (command === "usage") return commandUsage(options);
  if (command === "reload") return commandReload(options);
  if (command === "tail") return commandTail(options);
  throw new Error(`unknown command "${command}"`);
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
  main(process.argv.slice(2)).catch((error) => {
    console.error(`remo-gw: ${error.message}`);
    process.exit(1);
  });
}
