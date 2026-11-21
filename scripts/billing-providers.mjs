#!/usr/bin/env node
/**
 * Payment connections from the operator's shell (ADR-248, `spec/payment-providers.md`
 * §6.2). Stage 1 has no operator console, so this command is the only way to add, test,
 * pause and retire a provider.
 *
 *   pnpm billing:providers list
 *   pnpm billing:providers create --provider manual --mode live --currency RUB \
 *        --groups invoice --name "Счёт" --activate
 *   pnpm billing:providers set <id> --priority 10 --settings vat_code=1,tax_system_code=2
 *   pnpm billing:providers activate|pause|resume|retire|disable <id> --reason "..."
 *   pnpm billing:providers webhook-url <id>
 *
 * A secret is never an argument: it comes from `--secret-file` (JSON) so it cannot end up
 * in shell history or in a process listing. Only the fingerprint is printed. `manual`
 * needs no secret at all; the refusal for a provider without one is the adapter's, not a
 * hardcoded list here.
 *
 * Parsing is exported and pure, so every operator typo is a unit test without a database.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import {
  METHOD_GROUPS,
  MODES,
  PROVIDERS,
} from "../apps/sync/pg/payment-providers.mjs";
import { fakeProviderEnabled } from "../apps/sync/pay-fake.mjs";
import { encryptSecret, fingerprintSecret, kekFromEnv } from "../apps/sync/secrets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const PRIORITY = /^[0-9]+$/;

export const PROVIDER_USAGE = `usage:
  pnpm billing:providers list
  pnpm billing:providers create --provider <${PROVIDERS.join("|")}> --mode <test|live>
       --currency <ISO> [--currency <ISO>] --groups <${METHOD_GROUPS.join("|")}>[,<group>]
       --name "<operator label>" [--priority 100] [--settings key=value[,key=value]]
       [--secret-file <json>] [--activate]
  pnpm billing:providers set <connection-id> [--priority <n>] [--currency <ISO>]
       [--groups <group>[,<group>]] [--settings key=value[,key=value]]
  pnpm billing:providers activate|pause|resume|retire|disable <connection-id> [--reason "..."]
  pnpm billing:providers webhook-url <connection-id>

  --secret-file is a JSON object of the adapter's secret fields; it is sealed with
  REMO_KEK and only its fingerprint is printed. A secret is never accepted as a flag.
  activate, pause, resume, retire and disable move one step of the lifecycle; pause,
  retire and disable require --reason. disable refuses while live subscriptions remain.
  webhook-url prints REMO_APP_ORIGIN/billing/webhooks/<id>/<token>.`;

/** One command's lifecycle step, so the CLI and the store agree on the edges. */
const STATUS_COMMANDS = Object.freeze({
  activate: { to: "active", from: ["draft", "ready"], needsReason: false },
  pause: { to: "paused", from: ["active"], needsReason: true },
  resume: { to: "active", from: ["paused"], needsReason: false },
  retire: { to: "retiring", from: ["active", "paused"], needsReason: true },
  disable: { to: "disabled", from: ["active", "paused", "retiring"], needsReason: true },
});

/** Flags may repeat; a comma-separated value is the same as repeating the flag. */
function readFlags(args, booleans = new Set()) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (booleans.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    const previous = flags.get(name);
    flags.set(name, previous === undefined ? value : [].concat(previous, value));
    index += 1;
  }
  return { flags, positionals };
}

function rejectUnknown(flags, allowed, command) {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`${command} does not take --${name}`);
  }
}

function many(flags, name) {
  const value = flags.get(name);
  if (value === undefined) return [];
  return [].concat(value).flatMap((item) => String(item).split(","));
}

function one(flags, name) {
  const value = flags.get(name);
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function currencyList(flags, { required }) {
  const codes = [...new Set(many(flags, "currency").map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (required && codes.length === 0) {
    throw new Error("--currency is required (a three-letter ISO 4217 code, e.g. RUB)");
  }
  for (const code of codes) {
    if (!ISO_CURRENCY.test(code)) {
      throw new Error(`--currency ${JSON.stringify(code)} is not a three-letter ISO 4217 code`);
    }
  }
  return codes;
}

function groupList(flags, { required }) {
  const groups = [...new Set(many(flags, "groups").map((group) => group.trim()).filter(Boolean))];
  if (required && groups.length === 0) {
    throw new Error(`--groups is required (one of ${METHOD_GROUPS.join(", ")})`);
  }
  for (const group of groups) {
    if (!METHOD_GROUPS.includes(group)) {
      throw new Error(`--groups ${JSON.stringify(group)} must be one of ${METHOD_GROUPS.join(", ")}`);
    }
  }
  return groups;
}

/**
 * `key=value,key=value` → object.
 *
 * Only `true`, `false`, `null` and safe integers are typed. A bank account number is a
 * string that happens to look like digits: turning it into a JavaScript number would
 * silently lose its last digits, which is a wrong invoice rather than a parsing quirk.
 */
export function parseSettings(raw) {
  if (raw === undefined) return undefined;
  const settings = {};
  for (const pair of [].concat(raw).flatMap((item) => String(item).split(","))) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) throw new Error(`--settings ${JSON.stringify(trimmed)} is not key=value`);
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (value === "true") settings[key] = true;
    else if (value === "false") settings[key] = false;
    else if (value === "null") settings[key] = null;
    else if (/^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
      settings[key] = Number(value);
    } else settings[key] = value;
  }
  return settings;
}

function connectionId(raw, command) {
  const id = String(raw ?? "").trim();
  if (!id) throw new Error(`${command} needs a connection id`);
  if (!UUID.test(id)) throw new Error(`${command}: ${JSON.stringify(id)} is not a connection id`);
  return id;
}

function reasonOf(flags, command, { required }) {
  const reason = one(flags, "reason");
  const text = reason === undefined ? null : String(reason).trim();
  if (required && !text) throw new Error(`${command} needs --reason "..." to record why`);
  return text || null;
}

function priorityOf(flags) {
  const raw = one(flags, "priority");
  if (raw === undefined) return undefined;
  const text = String(raw).trim();
  if (!PRIORITY.test(text)) throw new Error("--priority must be a non-negative integer");
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error("--priority is too large");
  return value;
}

/**
 * Parse one command line into a plain object, or `{ help: true }`. No environment, no
 * database: every refusal below is an operator typo that must stop before a row exists.
 */
export function parseProviderArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const [command, ...rest] = argv;
  const { flags, positionals } = readFlags(rest, new Set(["activate"]));

  if (command === "list") {
    rejectUnknown(flags, [], "list");
    if (positionals.length > 0) throw new Error(`list does not take ${positionals[0]}`);
    return { command };
  }

  if (command === "create") {
    rejectUnknown(
      flags,
      [
        "provider",
        "mode",
        "currency",
        "groups",
        "name",
        "priority",
        "settings",
        "secret-file",
        "activate",
      ],
      "create",
    );
    if (positionals.length > 0) throw new Error(`create does not take ${positionals[0]}`);
    const provider = String(one(flags, "provider") ?? "").trim();
    if (!PROVIDERS.includes(provider)) {
      throw new Error(`--provider must be one of ${PROVIDERS.join(", ")}`);
    }
    const mode = String(one(flags, "mode") ?? "test").trim();
    if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
    const name = String(one(flags, "name") ?? "").trim();
    if (!name) throw new Error("--name is required: the operator label of this connection");
    return {
      command,
      provider,
      mode,
      name,
      currencies: currencyList(flags, { required: true }),
      methodGroups: groupList(flags, { required: true }),
      priority: priorityOf(flags) ?? 100,
      settings: parseSettings(flags.get("settings")) ?? {},
      secretFile: one(flags, "secret-file") ? String(one(flags, "secret-file")) : null,
      activate: flags.has("activate"),
    };
  }

  if (command === "set") {
    rejectUnknown(flags, ["priority", "currency", "groups", "settings"], "set");
    const id = connectionId(positionals[0], "set");
    if (positionals.length > 1) throw new Error("set takes one connection id");
    const currencies = currencyList(flags, { required: false });
    const methodGroups = groupList(flags, { required: false });
    const settings = parseSettings(flags.get("settings"));
    const priority = priorityOf(flags);
    if (
      priority === undefined &&
      currencies.length === 0 &&
      methodGroups.length === 0 &&
      settings === undefined
    ) {
      throw new Error("set needs at least one of --priority, --currency, --groups, --settings");
    }
    return {
      command,
      id,
      priority,
      currencies: currencies.length > 0 ? currencies : undefined,
      methodGroups: methodGroups.length > 0 ? methodGroups : undefined,
      settings,
    };
  }

  if (Object.hasOwn(STATUS_COMMANDS, command)) {
    const spec = STATUS_COMMANDS[command];
    rejectUnknown(flags, ["reason"], command);
    const id = connectionId(positionals[0], command);
    if (positionals.length > 1) throw new Error(`${command} takes one connection id`);
    return { command, id, to: spec.to, reason: reasonOf(flags, command, { required: spec.needsReason }) };
  }

  if (command === "webhook-url") {
    rejectUnknown(flags, [], "webhook-url");
    const id = connectionId(positionals[0], "webhook-url");
    if (positionals.length > 1) throw new Error("webhook-url takes one connection id");
    return { command, id };
  }

  throw new Error(`unknown command ${JSON.stringify(command)}`);
}

/**
 * Adapters are imported statically: a template-literal `import()` makes the test runner
 * rewrite this file and collide with the shebang. Adding a provider is one entry here
 * plus its `pay-<provider>.mjs`, which is the same one-file rule the ADR states.
 */
const ADAPTERS = Object.freeze({
  manual: () => import("../apps/sync/pay-manual.mjs"),
});

async function loadAdapter(provider) {
  // The fake adapter is imported here, not at module load: `.env` is read just before
  // `main` runs, so a flag placed there must still be able to select the development
  // provider without turning it into a production import.
  const load =
    provider === "fake"
      ? fakeProviderEnabled()
        ? () => import("../apps/sync/pay-fake.mjs")
        : null
      : ADAPTERS[provider];
  if (!load) {
    throw new Error(
      provider === "fake"
        ? "the fake provider is for development only: run with NODE_ENV!=production and REMO_PAY_FAKE=1"
        : `provider ${provider} has no adapter yet (apps/sync/pay-${provider}.mjs)`,
    );
  }
  const module = await load();
  return module.default ?? module[`${provider}Adapter`];
}

async function readSecretFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`--secret-file: cannot read ${path} (${error.code ?? error.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("--secret-file must contain one JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--secret-file must contain one JSON object");
  }
  return parsed;
}

function openStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: connections live in Postgres");
  }
  return new PostgresStore({
    connectionString,
    migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

function printConnection(row, { webhookUrl = null } = {}) {
  const secret = row.has_secret ? `secret ${row.secret_fingerprint ?? "?"}` : "no secret";
  console.log(
    `${row.id}  ${row.provider}/${row.mode}  ${row.status.padEnd(8)}  ` +
      `priority ${String(row.priority).padStart(3)}  ${row.currencies.join(",")}  ` +
      `${row.methodGroups.join(",")}  ${secret}`,
  );
  if (row.lastHealthError) console.log(`  last health: ${row.lastHealthError}`);
  if (webhookUrl) console.log(webhookUrl);
}

async function main(argv) {
  const args = parseProviderArgs(argv);
  if (args.help) {
    console.log(PROVIDER_USAGE);
    return;
  }

  // The KEK is required even for `list`: a shell without it can read the table, but an
  // operator who believes secrets work should learn here, not at the first checkout.
  const kek = kekFromEnv();
  if (!kek) throw new Error("REMO_KEK is required (32 bytes, base64); see docs/self-hosting");

  const store = openStore();
  await store.connect();
  try {
    if (args.command === "list") {
      const rows = await store.listConnections();
      if (rows.length === 0) {
        console.log("[billing:providers] no connections yet; create one with `pnpm billing:providers create ...`");
        return;
      }
      for (const row of rows) printConnection(row);
      return;
    }

    if (args.command === "create") {
      if (args.provider === "fake" && !fakeProviderEnabled()) {
        throw new Error(
          "the fake provider is for development only: run with NODE_ENV!=production and REMO_PAY_FAKE=1",
        );
      }
      if (args.provider === "manual" && args.secretFile) {
        throw new Error("manual needs no secret; refuse to store an unused key");
      }
      if (args.provider !== "manual" && !args.secretFile) {
        throw new Error(`${args.provider} needs --secret-file; a key is never passed as a flag`);
      }
      const adapter = await loadAdapter(args.provider);
      const secret = args.secretFile ? await readSecretFile(args.secretFile) : {};
      const problems = adapter.validateConfig(args.settings, secret);
      for (const problem of problems) {
        console.warn(`[billing:providers] warning: ${problem.field}: ${problem.message}`);
      }

      const id = randomUUID();
      let sealed = null;
      if (args.secretFile) {
        const text = JSON.stringify(secret);
        // The AAD binds the envelope to this id, provider and scope; the plaintext is
        // dropped with this block and never printed.
        sealed = {
          ...encryptSecret(text, { scope: "connection", scopeId: id, provider: args.provider, id, kek }),
          fingerprint: fingerprintSecret(text),
        };
      }

      const created = await store.createConnection({
        id,
        provider: args.provider,
        name: args.name,
        mode: args.mode,
        currencies: args.currencies,
        methodGroups: args.methodGroups,
        priority: args.priority,
        settings: args.settings,
        sealed,
        createdBy: null,
      });
      console.log(`[billing:providers] created ${created.id} (${created.status})`);
      let result = created;
      if (args.activate) {
        result = await store.setConnectionStatus(created.id, {
          from: "draft",
          to: "active",
          reason: args.provider === "manual" ? "activated at creation; manual needs no verify" : "activated at creation",
        });
        console.log(`[billing:providers] ${result.id} is ${result.status}`);
      }
      printConnection(result);
      return;
    }

    if (args.command === "set") {
      const updated = await store.updateConnectionSettings(args.id, {
        priority: args.priority,
        settings: args.settings,
        currencies: args.currencies,
        methodGroups: args.methodGroups,
        reason: "operator set",
      });
      console.log("[billing:providers] updated");
      printConnection(updated);
      return;
    }

    if (Object.hasOwn(STATUS_COMMANDS, args.command)) {
      const current = await store.connectionById(args.id);
      if (!current) throw new Error(`connection ${args.id} does not exist`);
      if (!STATUS_COMMANDS[args.command].from.includes(current.status)) {
        throw new Error(
          `cannot ${args.command} a connection that is ${current.status}; ` +
            `allowed from ${STATUS_COMMANDS[args.command].from.join(", ")}`,
        );
      }
      if (args.command === "disable") {
        const live = await store.liveSubscriptionsForConnection(args.id);
        if (live.length > 0) {
          const list = live
            .map((row) => `${row.org_id} (${row.plan}, ${row.status}, until ${row.current_period_end?.toISOString?.() ?? row.current_period_end})`)
            .join("\n  ");
          throw new Error(
            `refusing to disable ${args.id}: ${live.length} live subscription(s) renew through it\n  ${list}\n` +
              "retire it and move the payers to another connection first",
          );
        }
      }
      const updated = await store.setConnectionStatus(args.id, {
        from: current.status,
        to: args.to,
        reason: args.reason,
      });
      console.log(`[billing:providers] ${updated.id} is ${updated.status}`);
      printConnection(updated);
      return;
    }

    if (args.command === "webhook-url") {
      const connection = await store.connectionById(args.id);
      if (!connection) throw new Error(`connection ${args.id} does not exist`);
      const origin = String(process.env.REMO_APP_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
      console.log(`${origin}/billing/webhooks/${connection.id}/${connection.webhookToken}`);
    }
  } finally {
    await store.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[billing:providers] ${error.message}`);
    process.exitCode = 1;
  });
}
