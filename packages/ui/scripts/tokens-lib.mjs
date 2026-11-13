// Token pipeline for @remo/ui. `src/tokens/tokens.json` is the only source: every CSS
// file under `src/tokens/` is generated from it, and the contrast and naming checks
// read the same data, so a value can never be changed in one place and missed in
// another. Plain Node, no dependencies — like the other scripts in this repository.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TOKENS_PATH = fileURLToPath(new URL("../src/tokens/tokens.json", import.meta.url));
export const THEMES = ["light", "dark"];

/** Name prefixes per layer: the layer is visible in the name (ТЗ §4). */
export const LAYER_PREFIXES = {
  primitive: ["neutral", "accent", "danger", "success", "warning", "orange", "violet", "blue", "pink", "green", "yellow", "ochre", "paper", "alpha", "elev", "space", "radius", "z", "dur", "ease", "font"],
  semantic: ["bg", "text", "border", "accent", "danger", "success", "warning", "state", "selection", "presence", "sticker", "shadow", "type", "agent", "canvas"],
  component: ["control", "dialog", "panel", "topbar", "toolbar", "inspector", "icon", "label", "handle", "pin", "grid"],
};

export function loadTokens(path = TOKENS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const ref = (v) => (typeof v === "string" && v.startsWith("{") ? v.slice(1, -1) : null);
const css = (v) => (ref(v) ? `var(--${ref(v)})` : v);

/** Every token with its family, flattened. */
export function allTokens(t) {
  const out = [];
  for (const [family, block] of Object.entries(t)) {
    if (!block || typeof block !== "object" || !Array.isArray(block.tokens)) continue;
    for (const tok of block.tokens) out.push({ ...tok, family });
  }
  return out;
}

const typeTokens = (t) =>
  t.type.groups.flatMap((g) =>
    g.styles.map((s) => ({
      name: `type-${s.name}`,
      value: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${s.family ?? g.family})`,
      usage: s.usage,
    })),
  );

const block = (selector, rows) =>
  `${selector} {\n${rows.map((r) => `  --${r.name}: ${r.value};`).join("\n")}\n}\n`;

/** The generated files, keyed by their path under src/tokens/. */
export function buildCss(t) {
  const head = (what) => `/* REMO ${what} — generated from tokens.json by scripts/build-tokens.mjs. Do not edit. */\n`;
  const toks = allTokens(t);
  const prim = toks.filter((x) => x.layer === "primitive");
  const sem = toks.filter((x) => x.layer === "semantic");
  const comp = toks.filter((x) => x.layer === "component");
  const fixed = sem.filter((x) => typeof x.value === "string");
  const themed = sem.filter((x) => typeof x.value === "object");
  const families = Object.entries(t.type.families).map(([k, v]) => ({ name: `font-${k}`, value: v }));

  const primitive =
    head("primitives") +
    block(":root", [...prim.map((x) => ({ name: x.name, value: x.value })), ...families]);
  const semantic =
    head("semantic roles that do not depend on the theme") +
    block(":root", [...fixed.map((x) => ({ name: x.name, value: css(x.value) })), ...typeTokens(t)]);
  const theme = (id) =>
    head(`theme “${id}”`) +
    block(id === THEMES[0] ? `:root, [data-theme="${id}"]` : `[data-theme="${id}"]`, [
      ...themed.map((x) => ({ name: x.name, value: css(x.value[id]) })),
    ]) +
    (id === THEMES[0] ? ":root { color-scheme: light; }\n" : `[data-theme="${id}"] { color-scheme: ${id}; }\n`);
  const component =
    head("component tokens and density") +
    block(":root", [...comp.map((x) => ({ name: x.name, value: css(x.value) })), { name: "control-h", value: "var(--control-default)" }]) +
    `[data-density="compact"] {\n  --control-h: var(--control-compact);\n}\n` +
    `@media (prefers-reduced-motion: reduce) {\n  :root {\n    --dur-1: 0ms;\n    --dur-2: 0ms;\n  }\n}\n`;
  return {
    "primitive.css": primitive,
    "semantic.css": semantic,
    "themes/light.css": theme("light"),
    "themes/dark.css": theme("dark"),
    "component.css": component,
  };
}

// ---------- colour maths (WCAG 2) ----------

function parseColor(s) {
  if (s.startsWith("#")) {
    const h = s.length === 4 ? [...s.slice(1)].map((c) => c + c).join("") : s.slice(1, 7);
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: 1 };
  }
  const m = s.match(/[\d.]+/g).map(Number);
  return { rgb: m.slice(0, 3), a: m[3] ?? 1 };
}
function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
export function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Resolve a colour token to a plain value in a theme, following aliases. */
export function resolver(t) {
  const map = new Map(allTokens(t).filter((x) => x.family === "color").map((x) => [x.name, x.value]));
  return function resolve(name, theme) {
    let v = map.get(name);
    for (let i = 0; i < 16; i++) {
      if (v === undefined) throw new Error(`unknown colour token: ${name}`);
      if (typeof v === "object") v = v[theme] ?? v[THEMES[0]];
      const r = ref(v);
      if (!r) return v;
      v = map.get(r);
    }
    throw new Error(`alias chain too deep: ${name}`);
  };
}

const TEXT = ["text-primary", "text-secondary", "text-muted", "text-accent", "text-danger", "state-success", "state-warning", "state-info"];
const GROUNDS = ["bg-panel", "bg-raised", "bg-canvas", "bg-app", "bg-hover"];
const STICKERS = ["neutral", "yellow", "green", "blue", "pink", "violet", "orange"];

/** Every pair the system promises, with its floor (4.5 text, 3 for marks and borders). */
export const PAIRS = [
  ...TEXT.flatMap((f) => GROUNDS.map((g) => [f, g, 4.5])),
  ["text-accent", "accent-soft", 4.5], ["text-danger", "danger-soft", 4.5], ["text-agent", "agent-soft", 4.5], ["state-success", "success-soft", 4.5], ["state-warning", "warning-soft", 4.5], ["text-primary", "accent-soft", 4.5],
  ["text-on-accent", "accent", 4.5], ["text-on-accent", "accent-hover", 4.5], ["text-on-danger", "danger", 4.5], ["text-on-danger", "danger-hover", 4.5], ["text-inverse", "bg-inverse", 4.5],
  ["border-strong", "bg-panel", 3], ["border-strong", "bg-raised", 3], ["border-focus", "bg-panel", 3], ["border-focus", "bg-canvas", 3], ["border-focus", "bg-raised", 3],
  ["selection-stroke", "bg-canvas", 3], ["accent", "bg-panel", 3],
  ...[1, 2, 3, 4, 5, 6].map((i) => ["text-on-presence", `presence-${i}`, 4.5]),
  ...[1, 2, 3, 4, 5, 6].map((i) => [`presence-${i}`, "bg-canvas", 3]),
  ...STICKERS.map((c) => ["sticker-ink", `sticker-${c}`, 4.5]),
];

/** Contrast of every promised pair in every theme. Translucent grounds sit on bg-panel. */
export function contrastReport(t) {
  const resolve = resolver(t);
  const rows = [];
  for (const theme of THEMES) {
    const panel = parseColor(resolve("bg-panel", theme)).rgb;
    for (const [fg, bg, min] of PAIRS) {
      const b = parseColor(resolve(bg, theme));
      const ground = b.a < 1 ? over(b, panel) : b.rgb;
      const f = parseColor(resolve(fg, theme));
      const r = ratio(f.a < 1 ? over(f, ground) : f.rgb, ground);
      rows.push({ theme, fg, bg, min, ratio: Math.round(r * 100) / 100, ok: r >= min });
    }
  }
  return rows;
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|lab|lch)\(/i;

/** Naming, layering and duplication rules (ТЗ §4, приёмка 9). Returns problems. */
export function lintTokens(t) {
  const problems = [];
  const seen = new Set();
  for (const x of allTokens(t)) {
    if (!NAME.test(x.name)) problems.push(`${x.name}: not kebab-case`);
    if (seen.has(x.name)) problems.push(`${x.name}: declared twice`);
    seen.add(x.name);
    const layer = x.layer;
    if (!LAYER_PREFIXES[layer]) { problems.push(`${x.name}: unknown layer "${layer}"`); continue; }
    if (!LAYER_PREFIXES[layer].includes(x.name.split("-")[0])) problems.push(`${x.name}: prefix does not belong to layer ${layer}`);
    if (!x.usage) problems.push(`${x.name}: no usage note`);
    const values = typeof x.value === "object" ? Object.values(x.value) : [x.value];
    if (layer === "semantic") {
      // Values live only in primitives: a role is always an alias.
      for (const v of values) if (!ref(v)) problems.push(`${x.name}: semantic token holds a literal (${v})`);
      if (typeof x.value === "object") for (const th of THEMES) if (!(th in x.value)) problems.push(`${x.name}: no value for theme ${th}`);
    }
    if (layer === "component") for (const v of values) if (COLOR_LITERAL.test(String(v))) problems.push(`${x.name}: colour literal in a component token`);
  }
  for (const x of allTokens(t)) {
    const values = typeof x.value === "object" ? Object.values(x.value) : [x.value];
    for (const v of values) if (ref(v) && !seen.has(ref(v))) problems.push(`${x.name}: alias of missing ${ref(v)}`);
  }
  return problems;
}
