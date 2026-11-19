/**
 * Design-system rules the colour and layer checks do not cover: type, weight, spacing,
 * radius, motion, colour roles, DS controls, modal dialogs and icons.
 *
 * A strict gate (ADR-229): any finding fails, with its rule ID and line. The rule ids are
 * the audit's (DS-TYPE-01 …). An exception is a named line next to the rule it bends,
 * with its reason (DS-EXT-03): BUTTON_ALLOW, FIELD_ALLOW, TYPE_ALLOW, ICON_ALLOW, and
 * PENDING for what waits on something outside the code.
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

/**
 * DS-CTRL-01 asks for Button / IconButton where a raw <button> is an ordinary action. Some
 * buttons are not that: an item inside an ARIA composite widget, a control anchored to the
 * canvas, a selectable row or tile, a disclosure row, an identity chip. They keep their own
 * shape on purpose (ADR-224), so they are named here with the reason, and nowhere else.
 */
const COMPOSITE_ROLES = new Set(["menuitem", "menuitemradio", "menuitemcheckbox", "radio", "tab", "option"]);
export const BUTTON_ALLOW = {
  // On the canvas, positioned in board coordinates; their size follows the zoom.
  "table-insert": "canvas", "table-edge-add": "canvas", "table-header": "canvas",
  "section-title": "canvas", "section-view-badge": "canvas", "comment-pin": "canvas",
  // A row that opens or closes the part under it.
  "section-fill-row": "disclosure", "section-look-toggle": "disclosure", "tool-rail-caret": "disclosure",
  // A row or tile that is picked, not an action.
  "section-axis-row": "row", "comments-list-item": "row", "room-agent-thread": "row",
  "home-tile-main": "tile", "home-emoji": "tile", "home-emoji-none": "tile",
  // Who and where: the avatar or name is the control.
  "agent-avatar": "identity", "peer": "identity", "account-button": "identity", "topbar-path-button": "identity",
  // The DS menu row.
  "rm-menu-item": "menu",
};
/** Files whose every raw button is a swatch: the colour sample is the control. */
const BUTTON_ALLOW_FILES = new Set(["apps/web/src/object-panel/ColorWindow.tsx"]);

/** End of the opening tag that starts at `from`, skipping `>` inside `{…}` and strings. */
function openTagEnd(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return text.length;
}

/** Static class words of a tag: the literal itself, or the string parts of an expression. */
function classWords(tag) {
  const cls = tag.match(/\bclassName=(?:"([^"]*)"|\{([\s\S]*?)\}\s*(?:[a-zA-Z-]+=|\/?$))/);
  if (!cls) return [];
  return (cls[1] ?? cls[2].replace(/\$\{[^}]*\}/g, " ")).match(/[a-z][a-z0-9-]*/g) ?? [];
}

function allowedButton(tag) {
  const role = tag.match(/\brole="([a-z]+)"/);
  if (role && COMPOSITE_ROLES.has(role[1])) return true;
  return classWords(tag).some((word) => word in BUTTON_ALLOW);
}

/**
 * DS-CTRL-01/field, the same way (ADR-225): an editor that replaces a piece of text in
 * place, sized and placed like the text it edits, is not a form field with a label.
 */
export const FIELD_ALLOW = {
  "section-title-input": "in place", "table-header-editor": "in place", "board-title": "in place",
};
const allowedField = (tag) => classWords(tag).some((word) => word in FIELD_ALLOW);

/**
 * DS-TYPE-01/02 exceptions by selector (ADR-226). Canvas object text is not interface
 * text: the inline editor must draw bold the way the painter does, at 700.
 */
export const TYPE_ALLOW = {
  ".inline-editor b": "canvas text: the painter's bold is 700",
  ".inline-editor strong": "canvas text: the painter's bold is 700",
};
/** DS-ICON-01 exceptions by class (ADR-229): the glyph is text, not an icon. */
export const ICON_ALLOW = {
  "home-page-gap": "punctuation: the gap between page numbers",
};

const allowedType = (selector) => {
  const parts = selector.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part in TYPE_ALLOW);
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
  // The selector of the block being read, so a type exception can be named by it.
  let pending = "";
  let selector = "";
  text.split("\n").forEach((raw, index) => {
    const line = raw.split("/*")[0];
    const at = index + 1;
    if (line.includes("{")) {
      selector = (pending + " " + line.slice(0, line.lastIndexOf("{"))).trim();
      pending = "";
    } else if (!line.includes(";") && !line.includes("}")) {
      pending += ` ${line}`;
    }
    if (line.includes("}")) pending = "";
    const addRule = (rule, where) => {
      if (rule.startsWith("DS-TYPE") && allowedType(selector)) return;
      add(rule, where);
    };
    for (const match of line.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) {
      const [, name, fallback] = match;
      if (ALIASES.has(name)) add("DS-COLOR-01/alias", at);
      else if (PRIMITIVE.test(name)) add("DS-COLOR-01/primitive", at);
      else if (!defined.has(name) && !fallback) add("DS-COLOR-01/undefined", at);
    }
    // Declarations may share a line with their selector: `.x { font-size: 13px; }`.
    const body = line.includes("{") ? line.slice(line.lastIndexOf("{") + 1) : line;
    for (const decl of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;}]+)/g)) declaration(decl[1], decl[2], at, addRule);
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
  } else if (prop.startsWith("border") && prop.includes("radius") && /[1-9]/.test(bare) && !/^\s*(0|50%)\s*$/.test(bare)) {
    add("DS-SHAPE-01", at);
  } else if (["transition", "animation", "transition-duration"].includes(prop) && /\d+m?s\b/.test(bare)) {
    add("DS-MOTION-01", at);
  }
}

function tsxFindings(text, add, path = "") {
  const lineAt = (offset) => text.slice(0, offset).split("\n").length;
  if (/role="(?:alert)?dialog"/.test(text) && /aria-modal/.test(text)) {
    for (const match of text.matchAll(/aria-modal/g)) add("UX-DIALOG-01", lineAt(match.index));
  }
  if (!BUTTON_ALLOW_FILES.has(path)) {
    for (const match of text.matchAll(/<button\b/g)) {
      if (!allowedButton(text.slice(match.index, openTagEnd(text, match.index)))) add("DS-CTRL-01/button", lineAt(match.index));
    }
  }
  for (const match of text.matchAll(/<(?:input|select|textarea)\b/g)) {
    const tag = text.slice(match.index, openTagEnd(text, match.index));
    if (/type="(?:file|hidden|color|range)"/.test(tag) || allowedField(tag)) continue;
    add("DS-CTRL-01/field", lineAt(match.index));
  }
  for (const match of text.matchAll(/>\s*[✕×✓→←↑↓⋯…]\s*</g)) {
    const tagStart = text.lastIndexOf("<", match.index);
    const tag = text.slice(tagStart, match.index + 1);
    if (classWords(tag).some((word) => word in ICON_ALLOW)) continue;
    add("DS-ICON-01", lineAt(match.index));
  }
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
    else tsxFindings(text, add, path.split("\\").join("/"));
  };
  for (const file of walk(join(root, "apps/web/src"), [".css"])) scan(file, "css");
  for (const file of walk(join(root, "apps/web/src"), [".tsx"])) scan(file, "tsx");
  return findings;
}

/**
 * Findings that wait for something outside the code, by file, rule and exact count
 * (ADR-229). An entry that no longer matches fails, so it is deleted with the fix.
 */
export const PENDING = [
  {
    file: "apps/web/src/PresentationLayer.tsx",
    rule: "DS-CTRL-01/button",
    count: 4,
    why: "slide arrows wait for chevron-left, arrow-up and arrow-down from the illustrator",
  },
  {
    file: "apps/web/src/PresentationLayer.tsx",
    rule: "DS-ICON-01",
    count: 2,
    why: "the ↑ ↓ glyphs of the slide arrows, the same icons",
  },
];

/**
 * The gate: every finding not covered by a pending entry, and every pending entry whose
 * count no longer matches. Each problem names the rule ID and where to look.
 */
export function strictProblems(findings, pending = PENDING) {
  const problems = [];
  const key = (file, rule) => `${file}\u0000${rule}`;
  const waiting = new Map(pending.map((entry) => [key(entry.file, entry.rule), entry]));
  const seen = new Map();
  for (const finding of findings) {
    const k = key(finding.file, finding.rule);
    if (waiting.has(k)) {
      seen.set(k, (seen.get(k) ?? 0) + 1);
      continue;
    }
    problems.push(`${finding.rule} ${finding.file}:${finding.line} — ${RULES[finding.rule]}`);
  }
  for (const entry of pending) {
    const now = seen.get(key(entry.file, entry.rule)) ?? 0;
    if (now !== entry.count) {
      const lines = findings
        .filter((f) => f.file === entry.file && f.rule === entry.rule)
        .map((f) => f.line)
        .join(", ");
      problems.push(
        `${entry.rule} ${entry.file}: pending ${entry.count}, found ${now}${lines ? ` (lines ${lines})` : ""} — ` +
          (now < entry.count ? "update or delete the PENDING entry" : RULES[entry.rule]),
      );
    }
  }
  return problems;
}
