import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareWithBaseline, countFindings, scanDesignRules, tighten } from "./ui-design-rules.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "ui-design-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "packages/ui/src/tokens"), { recursive: true });
  writeFileSync(join(root, "packages/ui/src/tokens/semantic.css"), ":root { --space-2: 8px; --type-label: 500 13px/18px x; }");
  return root;
}

describe("design rules", () => {
  it("finds a literal on a one-line rule and in a block", () => {
    const root = tree({
      "apps/web/src/styles/a.css": ".x { font-size: 13px; padding: 6px; }\n.y {\n  gap: var(--space-2);\n  font: var(--type-label);\n}\n",
    });
    const rules = scanDesignRules(root).map((f) => `${f.rule}:${f.line}`);
    expect(rules).toEqual(["DS-TYPE-01:1", "DS-SPACE-01:1"]);
  });

  it("reports an alias, a primitive and an undefined variable, but not one with a fallback", () => {
    const root = tree({
      "apps/web/src/styles/a.css": ".x { color: var(--ink); border-color: var(--warning-300); background: var(--nope); width: var(--cols, 2); }\n",
    });
    expect(scanDesignRules(root).map((f) => f.rule)).toEqual([
      "DS-COLOR-01/alias",
      "DS-COLOR-01/primitive",
      "DS-COLOR-01/undefined",
    ]);
  });

  it("counts raw controls, hand-made modals and glyph icons in components", () => {
    const root = tree({
      "apps/web/src/A.tsx": '<div role="dialog" aria-modal="true"><button>×</button><input type="file" /><input /></div>',
    });
    expect(scanDesignRules(root).map((f) => f.rule).sort()).toEqual([
      "DS-CTRL-01/button",
      "DS-CTRL-01/field",
      "DS-ICON-01",
      "UX-DIALOG-01",
    ]);
  });

  it("ratchets: more fails, less must be tightened, tightening never raises a count", () => {
    const baseline = { "a.css": { "DS-TYPE-01": 3, "DS-SPACE-01": 2 } };
    const counts = countFindings([
      { file: "a.css", rule: "DS-TYPE-01", line: 1 },
      { file: "a.css", rule: "DS-TYPE-01", line: 2 },
      { file: "a.css", rule: "DS-SPACE-01", line: 3 },
      { file: "a.css", rule: "DS-SPACE-01", line: 4 },
      { file: "a.css", rule: "DS-SPACE-01", line: 5 },
    ]);
    const { worse, better } = compareWithBaseline(counts, baseline);
    expect(worse).toEqual([{ file: "a.css", rule: "DS-SPACE-01", now: 3, was: 2 }]);
    expect(better).toEqual([{ file: "a.css", rule: "DS-TYPE-01", now: 2, was: 3 }]);
    expect(tighten(counts, baseline)).toEqual({ "a.css": { "DS-SPACE-01": 2, "DS-TYPE-01": 2 } });
  });
});
