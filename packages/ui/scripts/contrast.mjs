#!/usr/bin/env node
// pnpm ds:contrast — every promised colour pair in every theme (ТЗ §7, приёмка 3 и 8).
import { contrastReport, loadTokens } from "./tokens-lib.mjs";

const rows = contrastReport(loadTokens());
const failed = rows.filter((r) => !r.ok);
for (const r of failed) console.error(`FAIL ${r.theme.padEnd(5)} ${r.fg} on ${r.bg}: ${r.ratio} < ${r.min}`);
console.log(`${rows.length - failed.length}/${rows.length} pairs pass (${new Set(rows.map((r) => r.theme)).size} themes)`);
process.exit(failed.length ? 1 : 0);
