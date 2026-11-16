import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDesignRules, strictProblems } from "./ui-design-rules.mjs";

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

  it("leaves composite-widget items and allow-listed controls, counts an ordinary button", () => {
    const root = tree({
      "apps/web/src/B.tsx": [
        '<button role="menuitem" onClick={() => go()}>Open</button>',
        '<button type="button" className={`comment-pin${active ? " active" : ""}`} onClick={() => x > 1}>1</button>',
        '<button type="button" className={on ? "peer following" : "peer"}>A</button>',
        '<button type="button" className="peer-ish" onClick={() => a > b}>No</button>',
        '<button type="button" onClick={apply}>Apply</button>',
      ].join("\n"),
    });
    const lines = scanDesignRules(root).filter((f) => f.rule === "DS-CTRL-01/button").map((f) => f.line);
    expect(lines).toEqual([4, 5]);
  });

  it("leaves an in-place editor and reads a field tag past an arrow function", () => {
    const root = tree({
      "apps/web/src/C.tsx": [
        '<input className="board-title" onBlur={(e) => e.target.value > ""} />',
        '<input type="file" onChange={(e) => go(e)} />',
        '<input value={x} onChange={(e) => set(e.target.value)} />',
      ].join("\n"),
    });
    const lines = scanDesignRules(root).filter((f) => f.rule === "DS-CTRL-01/field").map((f) => f.line);
    expect(lines).toEqual([3]);
  });

  it("exempts canvas text by selector, every part of a selector list, and nothing else", () => {
    const root = tree({
      "apps/web/src/a.css": [
        ".inline-editor b,",
        ".inline-editor strong {",
        "  font-weight: 700;",
        "}",
        ".inline-editor b, .label { font-weight: 700; }",
        ".label {",
        "  font-size: 13px;",
        "}",
      ].join("\n"),
    });
    const lines = scanDesignRules(root).filter((f) => f.rule.startsWith("DS-TYPE")).map((f) => f.line);
    expect(lines).toEqual([5, 7]);
  });

  it("reads zeros in a radius as no radius, and flags any other literal", () => {
    const root = tree({
      "apps/web/src/a.css": [
        ".a { border-radius: var(--radius-sm) var(--radius-sm) 0 0; }",
        ".b { border-radius: 0; }",
        ".c { border-radius: 10px 10px 0 0; }",
      ].join("\n"),
    });
    const lines = scanDesignRules(root).filter((f) => f.rule === "DS-SHAPE-01").map((f) => f.line);
    expect(lines).toEqual([3]);
  });

  it("fails every finding by rule and line, and holds a pending entry to its exact count", () => {
    const pending = [{ file: "a.tsx", rule: "DS-ICON-01", count: 2, why: "icons on order" }];
    const finding = (file, rule, line) => ({ file, rule, line });
    expect(strictProblems([finding("a.tsx", "DS-ICON-01", 3), finding("a.tsx", "DS-ICON-01", 9)], pending)).toEqual([]);

    const extra = strictProblems([finding("b.css", "DS-TYPE-01", 4)], []);
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatch(/^DS-TYPE-01 b\.css:4 — /);

    const more = strictProblems(
      [1, 2, 3].map((line) => finding("a.tsx", "DS-ICON-01", line)),
      pending,
    );
    expect(more).toEqual([expect.stringMatching(/pending 2, found 3 \(lines 1, 2, 3\)/)]);

    const fewer = strictProblems([finding("a.tsx", "DS-ICON-01", 3)], pending);
    expect(fewer).toEqual([expect.stringMatching(/pending 2, found 1 .*delete the PENDING entry/)]);
  });

  it("leaves a glyph that is punctuation by its class", () => {
    const root = tree({
      "apps/web/src/C.tsx": ['<span className="home-page-gap">…</span>', "<span>…</span>"].join("\n"),
    });
    const lines = scanDesignRules(root).filter((f) => f.rule === "DS-ICON-01").map((f) => f.line);
    expect(lines).toEqual([2]);
  });
});
