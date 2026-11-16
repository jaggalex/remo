/**
 * Design-system rules the colour and layer checks do not cover: type, weight, spacing,
 * radius, motion, colour roles, DS controls, modal dialogs and icons.
 *
 * The product has many existing deviations, so this is a ratchet, not a wall: the count
 * of each rule in each file may only go down. `ui-design-baseline.json` records the
 * counts; a file that gains a deviation fails, and a file that loses one fails until the
 * baseline is tightened, so an improvement cannot be undone later in the same file.
 * Rules whose baseline is zero are absolute. The rule ids are the audit's
 * (DS-TYPE-01 …); the migration plan brings every count to zero, then the baseline
 * goes away.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The DS catalogue demonstrates tokens; help has its own reading styles. */
const SKIP_DIRS = new Set(["ds", "help"]);

const ALIASES = new Set(["--ink", "--muted", "--faint", "--line", "--line-strong", "--accent-strong", "--surface", "--canvas"]);
const PRIMITIVE =
  /^--(?:neutral|alpha|paper|green|blue|pink|orange|ochre|violet|elev)-[a-z0-9-]+$|^--(?:success|warning|danger|accent)-\d+$/;
const WEIGHTS = new Set(["400", "500", "600", "inherit", "normal"]);

export const RULES = {
  "DS-TYPE-01": "font-size is a literal; use font: var(--type-*)",
  "DS-TYPE-02": "font-weight outside 400/500/600",
  "DS-SPACE-01": "padding/margin/gap literal; use var(--space-*)",
  "DS-SHAPE-01": "border-radius literal; use var(--radius-*)",
  "DS-MOTION-01": "transition/animation duration literal; use var(--dur-*)",
  "DS-COLOR-01/alias": "alias of the previous system (--ink, --line …); use the semantic token",
  "DS-COLOR-01/primitive": "primitive colour token; use a semantic role",
  "DS-COLOR-01/undefined": "var() of a variable that is defined nowhere",
  "DS-CTRL-01/button": "raw <button>; use Button / IconButton from @remo/ui",
  "DS-CTRL-01/field": "raw <input>/<select>/<textarea>; use the @remo/ui field",
  "UX-DIALOG-01": "aria-modal outside @remo/ui; use Dialog / ConfirmDialog",
  "DS-ICON-01": "a text glyph as an icon (× ✕ → …); use Icon / IconButton",
};

function walk(directory, extensions, out = []) {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext)) && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

function definedVariables(root) {
  const names = new Set();
  const collect = (text) => {
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1]);
  };
  for (const file of walk(join(root, "packages/ui/src"), [".css"])) collect(readFileSync(file, "utf8"));
  for (const file of walk(join(root, "apps/web/src"), [".css"])) collect(readFileSync(file, "utf8"));
  // A component may set its own variable inline: style={{ "--who": colour }}.
  for (const base of ["apps/web/src", "packages/ui/src/components"]) {
    for (const file of walk(join(root, base), [".ts", ".tsx"])) {
      for (const match of readFileSync(file, "utf8").matchAll(/["'](--[a-z0-9-]+)["']\s*:/g)) names.add(match[1]);
    }
  }
  return names;
}

const stripVars = (value) => value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "");

function cssFindings(text, defined, add) {
  text.split("\n").forEach((raw, index) => {
    const line = raw.split("/*")[0];
    const at = index + 1;
    for (const match of line.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) {
      const [, name, fallback] = match;
      if (ALIASES.has(name)) add("DS-COLOR-01/alias", at);
      else if (PRIMITIVE.test(name)) add("DS-COLOR-01/primitive", at);
      else if (!defined.has(name) && !fallback) add("DS-COLOR-01/undefined", at);
    }
    // Declarations may share a line with their selector: `.x { font-size: 13px; }`.
    const body = line.includes("{") ? line.slice(line.lastIndexOf("{") + 1) : line;
    for (const decl of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;}]+)/g)) declaration(decl[1], decl[2], at, add);
  });
}

function declaration(prop, value, at, add) {
  const bare = stripVars(value);
  if (prop === "font-size" && /\d/.test(bare)) add("DS-TYPE-01", at);
  else if (prop === "font" && /\d+(?:\.\d+)?px/.test(bare)) add("DS-TYPE-01", at);
  else if (prop === "font-weight" && !WEIGHTS.has(value.trim()) && !value.includes("var(")) add("DS-TYPE-02", at);
  else if (/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/.test(prop)) {
    // 0–2 px are hairline and optical nudges, not spacing.
    if ([...bare.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)].some((m) => Number(m[1]) > 2)) add("DS-SPACE-01", at);
  } else if (prop.startsWith("border") && prop.includes("radius") && /\d/.test(bare) && !/^\s*(0|50%)\s*$/.test(bare)) {
    add("DS-SHAPE-01", at);
  } else if (["transition", "animation", "transition-duration"].includes(prop) && /\d+m?s\b/.test(bare)) {
    add("DS-MOTION-01", at);
  }
}

function tsxFindings(text, add) {
  const lineAt = (offset) => text.slice(0, offset).split("\n").length;
  if (/role="(?:alert)?dialog"/.test(text) && /aria-modal/.test(text)) {
    for (const match of text.matchAll(/aria-modal/g)) add("UX-DIALOG-01", lineAt(match.index));
  }
  for (const match of text.matchAll(/<button\b/g)) add("DS-CTRL-01/button", lineAt(match.index));
  for (const match of text.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
    if (/type="(?:file|hidden|color|range)"/.test(match[0])) continue;
    add("DS-CTRL-01/field", lineAt(match.index));
  }
  for (const match of text.matchAll(/>\s*[✕×✓→←↑↓⋯…]\s*</g)) add("DS-ICON-01", lineAt(match.index));
}

/** Every finding as { file, rule, line }, scanned from the product sources. */
export function scanDesignRules(root) {
  const defined = definedVariables(root);
  const findings = [];
  const scan = (file, kind) => {
    const path = relative(root, file);
    const add = (rule, line) => findings.push({ file: path, rule, line });
    const text = readFileSync(file, "utf8");
    if (kind === "css") cssFindings(text, defined, add);
    else tsxFindings(text, add);
  };
  for (const file of walk(join(root, "apps/web/src"), [".css"])) scan(file, "css");
  for (const file of walk(join(root, "apps/web/src"), [".tsx"])) scan(file, "tsx");
  return findings;
}

/** Counts per file and rule: { "apps/web/src/x.css": { "DS-TYPE-01": 3 } }. */
export function countFindings(findings) {
  const counts = {};
  for (const { file, rule } of findings) {
    counts[file] ??= {};
    counts[file][rule] = (counts[file][rule] ?? 0) + 1;
  }
  return counts;
}

/**
 * Compare current counts with the baseline. `worse` fails the check; `better` fails
 * too until the baseline is tightened, so the ratchet only ever moves down.
 */
export function compareWithBaseline(counts, baseline) {
  const worse = [];
  const better = [];
  const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  for (const file of files) {
    const now = counts[file] ?? {};
    const was = baseline[file] ?? {};
    for (const rule of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const n = now[rule] ?? 0;
      const b = was[rule] ?? 0;
      if (n > b) worse.push({ file, rule, now: n, was: b });
      else if (n < b) better.push({ file, rule, now: n, was: b });
    }
  }
  return { worse, better };
}

/** The tightened baseline: never higher than before, per file and rule. */
export function tighten(counts, baseline) {
  const next = {};
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, n] of Object.entries(rules)) {
      const was = baseline[file]?.[rule];
      const value = was === undefined ? n : Math.min(n, was);
      if (value > 0) (next[file] ??= {})[rule] = value;
    }
  }
  return Object.fromEntries(
    Object.keys(next)
      .sort()
      .map((file) => [file, Object.fromEntries(Object.keys(next[file]).sort().map((r) => [r, next[file][r]]))]),
  );
}
