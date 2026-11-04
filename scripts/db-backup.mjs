/**
 * Backup and restore for the board database.
 *
 *   node scripts/db-backup.mjs                 # take a backup, prune old ones
 *   node scripts/db-backup.mjs --list          # what is on disk
 *   node scripts/db-backup.mjs --restore FILE  # show what restoring would do
 *   node scripts/db-backup.mjs --restore FILE --yes   # do it
 *
 * Two things this is careful about, because a database tool that loses data is
 * worse than no tool:
 *
 *  1. `pg_dump`/`pg_restore` are used when present; otherwise the compose container
 *     is asked to run them, so a machine with only Docker still gets a real dump.
 *  2. A restore is destructive, so it does nothing without `--yes`, keeps a safety
 *     backup of the current state first, and refuses to overwrite a database that
 *     holds boards unless `--force` says the loss is intended.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BACKUP_DIR = process.env.REMO_BACKUP_DIR ?? join(ROOT, "backups");

/**
 * How many dumps to keep; oldest go first once the list is longer.
 *
 * `Number("")` is 0 and `Number("abc")` is NaN; `slice(0)` and `slice(NaN)` both
 * return the whole list, which used to delete every dump including the new one.
 */
export function backupKeep(raw = process.env.REMO_BACKUP_KEEP) {
  if (raw === undefined || raw === "") return 14;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("REMO_BACKUP_KEEP must be a positive integer");
  }
  return value;
}

const KEEP = backupKeep();
/** The compose service that runs postgres, used when pg_dump is not installed. */
const COMPOSE_SERVICE = process.env.REMO_DB_SERVICE ?? "db";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(ROOT, ".env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env — fall through to the compose defaults */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

function parts(url) {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username) || "remo",
    password: decodeURIComponent(parsed.password) || "remo",
    database: parsed.pathname.replace(/^\//, "") || "remo",
    host: parsed.hostname,
    port: parsed.port || "5432",
    /** Never print the password; logs and manifests end up in tickets. */
    safe: url.replace(/:[^:@/]+@/, ":***@"),
  };
}

const target = parts(databaseUrl());

/** True when `pg_dump` can be run directly, false when the container must do it. */
function which(command) {
  return new Promise((resolve) => {
    const probe = spawn("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    probe.on("error", () => resolve(null));
    probe.on("close", (code) => resolve(code === 0 ? command : null));
  });
}

/**
 * Run a command, optionally streaming its stdout to a file or a file into its
 * stdin. Both directions are needed: the dump is written on the host, but the
 * container has no access to the host filesystem.
 */
function run(command, args, { stdoutFile, stdinFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdinFile ? "pipe" : "ignore", stdoutFile ? "pipe" : "inherit", "inherit"],
    });

    let stream;
    if (stdoutFile) {
      stream = createWriteStream(stdoutFile);
      child.stdout.pipe(stream);
    }
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin);

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${command} exited with ${code}`));
      if (stream) stream.end(() => resolve());
      else resolve();
    });
  });
}

/** A `pg_dump` invocation, either local or through the compose container. */
async function dumper() {
  if (await which("pg_dump")) {
    return {
      kind: "local",
      dump: (file) =>
        run("pg_dump", ["--format=custom", "--no-owner", "--file", file, databaseUrl()]),
      restore: (file) =>
        run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", databaseUrl(), file]),
    };
  }
  return {
    kind: "docker",
    dump: (file) =>
      run(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          COMPOSE_SERVICE,
          "pg_dump",
          "--format=custom",
          "--no-owner",
          "-U",
          target.user,
          "-d",
          target.database,
        ],
        { stdoutFile: file },
      ),
    restore: (file) =>
      run(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          COMPOSE_SERVICE,
          "pg_restore",
          "--clean",
          "--if-exists",
          "--no-owner",
          "-U",
          target.user,
          "-d",
          target.database,
          // No archive argument: pg_restore then reads the archive from stdin, which
          // is how a host file reaches a process inside the container.
        ],
        { stdinFile: file },
      ),
  };
}

async function connect() {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function boardCount() {
  const client = await connect();
  try {
    const { rows } = await client.query(
      "select count(*)::int as boards from boards",
    ).catch(() => ({ rows: [{ boards: 0 }] }));
    return rows[0]?.boards ?? 0;
  } finally {
    await client.end();
  }
}

async function rowCounts() {
  const client = await connect();
  try {
    const tables = ["boards", "board_updates", "widgets", "kanban_columns", "kanban_swimlanes", "kanban_cards"];
    const counts = {};
    for (const table of tables) {
      const { rows } = await client
        .query(`select count(*)::int as n from ${table}`)
        .catch(() => ({ rows: [{ n: 0 }] }));
      counts[table] = rows[0]?.n ?? 0;
    }
    return counts;
  } finally {
    await client.end();
  }
}

function stamp(date = new Date()) {
  const iso = date.toISOString().replace(/[:.]/g, "-");
  return iso.slice(0, 19);
}

async function sha256(file) {
  const buffer = await readFileSync(file);
  return createHash("sha256").update(buffer).digest("hex");
}

/** Existing backups, newest first. */
async function listBackups() {
  try {
    const entries = await readdir(BACKUP_DIR);
    const files = entries.filter((name) => name.endsWith(".dump")).sort().reverse();
    const out = [];
    for (const name of files) {
      const path = join(BACKUP_DIR, name);
      const info = await stat(path);
      out.push({ name, path, bytes: info.size, at: info.mtime });
    }
    return out;
  } catch {
    return [];
  }
}

async function prune(keepPath = null) {
  const backups = await listBackups();
  // A restore must never prune the file it is about to read.
  const candidates = keepPath ? backups.filter((backup) => backup.path !== keepPath) : backups;
  const doomed = candidates.slice(KEEP);
  for (const backup of doomed) {
    await rm(backup.path, { force: true });
    await rm(backup.path.replace(/\.dump$/, ".json"), { force: true });
    console.log(`[backup] pruned ${backup.name}`);
  }
  return doomed.length;
}

async function backup() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const name = `remo-${stamp()}.dump`;
  const file = join(BACKUP_DIR, name);
  const runner = await dumper();

  console.log(`[backup] ${target.safe} -> ${file} (${runner.kind})`);
  await runner.dump(file);

  const info = await stat(file);
  if (info.size === 0) throw new Error("the dump is empty; nothing was written");

  const manifest = {
    file: name,
    at: new Date().toISOString(),
    database: target.safe,
    bytes: info.size,
    sha256: await sha256(file),
    rows: await rowCounts(),
    runner: runner.kind,
  };
  await writeFile(file.replace(/\.dump$/, ".json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[backup] ${name} (${info.size} bytes, sha256 ${manifest.sha256.slice(0, 12)}…)`);
  await prune();
  return file;
}

async function restore(file) {
  const path = file.startsWith("/") ? file : join(BACKUP_DIR, file);
  await stat(path);

  const boards = await boardCount();
  console.log(`[restore] from   ${path}`);
  console.log(`[restore] into   ${target.safe} (currently ${boards} board(s))`);

  if (!flag("yes")) {
    console.log("[restore] nothing was changed — add --yes to run the restore.");
    return;
  }
  if (boards > 0 && !flag("force")) {
    console.error(
      `[restore] refusing: the database holds ${boards} board(s) that would be replaced.\n` +
        "          Re-run with --force if that loss is intended, or restore into an empty database.",
    );
    process.exitCode = 1;
    return;
  }

  // Safety net: the state being replaced is saved before it disappears.
  const safety = await backup({ keepPath: path });
  console.log(`[restore] safety copy: ${safety}`);

  const runner = await dumper();
  await runner.restore(path);
  console.log("[restore] done");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
try {
  if (flag("list")) {
    const backups = await listBackups();
    if (!backups.length) console.log(`[backup] none in ${BACKUP_DIR}`);
    for (const entry of backups) {
      console.log(`${entry.name}  ${entry.bytes} bytes  ${entry.at.toISOString()}`);
    }
  } else if (value("restore")) {
    await restore(value("restore"));
  } else {
    await backup();
  }
} catch (error) {
  console.error(`[backup] failed: ${error.message}`);
  process.exitCode = 1;
}
}
