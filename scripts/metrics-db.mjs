#!/usr/bin/env node
/**
 * Creates the separate product-metrics database and applies its schema (ADR-082).
 * It uses the app's PostgreSQL credentials only to create a database; the metrics
 * tables are then created in `remo_metrics` (or REMO_METRICS_DB).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { METRICS_SCHEMA } from "../apps/sync/metrics-store.mjs";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch {
  /* .env is optional */
}

const base = process.env.DATABASE_URL ?? "postgres://remo:remo@localhost:5432/remo";
const targetName = process.env.REMO_METRICS_DB ?? "remo_metrics";
const url = new URL(base);
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";

const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 });
try {
  await admin.query(`create database ${targetName}`);
  console.log(`created database ${targetName}`);
} catch (error) {
  if (error.code !== "42P04") throw error;
  console.log(`database ${targetName} already exists`);
} finally {
  await admin.end();
}

url.pathname = `/${targetName}`;
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
await pool.query(METRICS_SCHEMA);
await pool.end();
console.log(`metrics schema ready in ${targetName}`);
