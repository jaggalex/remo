/**
 * Where one run of the browser gate listens (ADR-130).
 *
 * One run owns three ports, one database, one run id and its own artifact directories. A
 * second run shifts all three ports with `E2E_PORT_BASE` and gets its own database name,
 * run id and directories, which is what lets two worktrees — or two agents — validate at
 * the same time.
 *
 *   pnpm e2e                        # 1235 / 1237 / 5175, database remo_test_e2e_<run>
 *   E2E_PORT_BASE=1000 pnpm e2e     # 2235 / 2237 / 6175, remo_test_e2e_1000_<run>
 *   E2E_WORKERS=2 pnpm e2e          # file-level parallelism, opt-in
 *
 * The run id is generated once by scripts/e2e-run.mjs (`E2E_RUN_ID`) and is part of both
 * the database name and the default artifact paths. Default and shifted runs therefore
 * have sibling directories, never an ancestor relationship: cleaning one cannot delete
 * the other's evidence, even when both used the same suffix.
 *
 * The environment is read through a narrow cast, the way apps/web/vite.config.ts does it:
 * the repository has no `@types/node` at the root, and this module needs a few fields.
 */
import { resolve, sep } from "node:path";
import { e2eDatabaseName, isValidRunToken, normalizeRunSuffix } from "../scripts/db-identifiers.mjs";
import { databaseUrlFor, testPostgresUrl } from "../scripts/test-environment.mjs";

interface RunEnv {
  E2E_PORT_BASE?: string;
  E2E_SYNC_PORT?: string;
  E2E_PROXY_PORT?: string;
  E2E_WEB_PORT?: string;
  E2E_RUN_SUFFIX?: string;
  E2E_RUN_ID?: string;
  E2E_WORKERS?: string;
  E2E_OUTPUT_DIR?: string;
  E2E_REPORT_DIR?: string;
  REMO_TEST_POSTGRES_URL?: string;
  /** Present only to prove it is ignored; the test configuration never reads it. */
  DATABASE_URL?: string;
}

const root =
  (globalThis as { process?: { env?: RunEnv; pid?: number } }).process ?? {};
const env: RunEnv = root.env ?? {};

const DEFAULT_BASE = 0;
const DEFAULT_SYNC_PORT = 1235;
const DEFAULT_PROXY_PORT = 1237;
const DEFAULT_WEB_PORT = 5175;

function integer(raw: string | undefined, name: string, fallback: number, minimum: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function port(raw: string | undefined, name: string, fallback: number): number {
  const value = integer(raw, name, fallback, 1);
  if (value > 65535) throw new Error(`${name} must be a valid TCP port, got ${value}`);
  return value;
}

/** A run token generated here only when `E2E_RUN_ID` is absent (direct Playwright use). */
function generatedRunId(): string {
  const pid = root.pid ?? 0;
  const crypto = (globalThis as {
    crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array };
  }).crypto;
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${pid}_${hex}`;
  }
  return `${pid}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A run suffix: lowercase, digits and single underscores. It becomes part of an
 * identifier, so a value that would need rewriting is refused instead of silently
 * collapsing two different runs onto one database name.
 */
export function runSuffix(value: string): string {
  return normalizeRunSuffix(value);
}

/** True when `parent` contains `child` (strictly, not equality). */
export function isAncestorPath(parent: string, child: string): boolean {
  const from = resolve(parent);
  const to = resolve(child);
  return to.startsWith(`${from}${sep}`) && to !== from;
}

function assertArtifactsDisjoint(outputDir: string, reportDir: string): void {
  if (
    resolve(outputDir) === resolve(reportDir) ||
    isAncestorPath(outputDir, reportDir) ||
    isAncestorPath(reportDir, outputDir)
  ) {
    throw new Error(
      `E2E_OUTPUT_DIR (${outputDir}) and E2E_REPORT_DIR (${reportDir}) must be separate, ` +
        "non-nested directories: one run's cleanup must not delete its own report",
    );
  }
}

export interface RunConfig {
  base: number;
  suffix: string;
  runId: string;
  syncPort: number;
  proxyPort: number;
  webPort: number;
  workers: number;
  databaseName: string;
  databaseUrl: string;
  testPostgresUrl: string;
  outputDir: string;
  reportDir: string;
}

/** Everything one run owns, resolved from an environment map (pure, testable). */
export function resolveRun(source: RunEnv): RunConfig {
  const base = integer(source.E2E_PORT_BASE, "E2E_PORT_BASE", DEFAULT_BASE, 0);
  // An empty suffix is "not set": with a shifted base it must still get its own identity,
  // or it would share the default run's database and report directories.
  const explicitSuffix = source.E2E_RUN_SUFFIX?.trim() ?? "";
  const rawSuffix = explicitSuffix !== "" ? explicitSuffix : base > 0 ? String(base) : "";
  const suffix = runSuffix(rawSuffix);

  const runId = (source.E2E_RUN_ID?.trim() || generatedRunId()).toLowerCase();
  if (!isValidRunToken(runId)) {
    throw new Error(
      `E2E_RUN_ID ${JSON.stringify(source.E2E_RUN_ID)} must match [a-z0-9] with single ` +
        "underscores and be at most 40 characters",
    );
  }

  const databaseName = e2eDatabaseName(suffix, runId);
  const testServer = testPostgresUrl(source);
  const databaseUrl = databaseUrlFor(testServer, databaseName);

  // Every default is run-scoped; "default" and "1000" are labels, never shared leaves.
  const label = suffix === "" ? "default" : suffix;
  const outputDir = source.E2E_OUTPUT_DIR ?? `test-results/${label}_${runId}`;
  const reportDir = source.E2E_REPORT_DIR ?? `e2e-report/${label}_${runId}`;
  assertArtifactsDisjoint(outputDir, reportDir);

  return {
    base,
    suffix,
    runId,
    syncPort: port(source.E2E_SYNC_PORT, "E2E_SYNC_PORT", DEFAULT_SYNC_PORT + base),
    proxyPort: port(source.E2E_PROXY_PORT, "E2E_PROXY_PORT", DEFAULT_PROXY_PORT + base),
    webPort: port(source.E2E_WEB_PORT, "E2E_WEB_PORT", DEFAULT_WEB_PORT + base),
    workers: integer(source.E2E_WORKERS, "E2E_WORKERS", 1, 1),
    databaseName,
    databaseUrl,
    testPostgresUrl: testServer,
    outputDir,
    reportDir,
  };
}

const run = resolveRun(env);

export const PORT_BASE = run.base;
export const RUN_SUFFIX = run.suffix;
export const RUN_ID = run.runId;
export const SYNC_PORT = run.syncPort;
export const PROXY_PORT = run.proxyPort;
export const WEB_PORT = run.webPort;

/**
 * The database this run manages, always on the dedicated test server. There is no explicit
 * database-URL escape hatch: it would bypass the installed environment identity.
 */
export const DATABASE_NAME = run.databaseName;
export const TEST_POSTGRES_URL = run.testPostgresUrl;
export const E2E_DATABASE_URL = run.databaseUrl;

/** Files are distributed across workers; scenarios inside one file stay serial (ADR-090). */
export const WORKERS = run.workers;

export const OUTPUT_DIR = run.outputDir;
export const REPORT_DIR = run.reportDir;
