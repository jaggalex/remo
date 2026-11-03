import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCss, contrastReport, lintTokens, loadTokens } from "../scripts/tokens-lib.mjs";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const tokens = loadTokens();

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("tokens", () => {
  it("follow naming, layering and alias rules (приёмка 9)", () => {
    expect(lintTokens(tokens)).toEqual([]);
  });

  it("meet contrast in every theme (приёмка 3, 8)", () => {
    const failed = contrastReport(tokens).filter((r) => !r.ok).map((r) => `${r.theme} ${r.fg} on ${r.bg}: ${r.ratio}`);
    expect(failed).toEqual([]);
  });

  it("give every themed role a value in each theme, so no var() is left empty (приёмка 8)", () => {
    const css = buildCss(tokens);
    const declared = (text: string) => new Set([...text.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
    const light = declared(css["themes/light.css"]!), dark = declared(css["themes/dark.css"]!);
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
    expect([...dark].filter((n) => !light.has(n))).toEqual([]);
    const all = new Set(Object.values(css).flatMap((text) => [...declared(text)]));
    const used = Object.values(css).flatMap((text) => [...text.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.filter((n) => !all.has(n!))).toEqual([]);
  });

  it("keep the generated CSS in sync with tokens.json", () => {
    for (const [file, text] of Object.entries(buildCss(tokens))) {
      expect(readFileSync(join(SRC, "tokens", file), "utf8"), `src/tokens/${file} is stale — run pnpm ds:tokens`).toBe(text);
    }
  });

  it("keep selection fill at 8 % (ТЗ §5)", () => {
    const prim = tokens.color.tokens.filter((t: { layer: string }) => t.layer === "primitive");
    for (const name of ["alpha-accent-8", "alpha-accent-light-8"]) {
      expect(prim.find((t: { name: string }) => t.name === name)?.value).toMatch(/,\s*0\.08\)$/);
    }
  });
});

describe("no literal colours outside the token files (приёмка 2)", () => {
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/;
  const sources = files(SRC).filter((p) => /\.(css|tsx?)$/.test(p) && !p.includes(`${join(SRC, "tokens")}`) && !p.endsWith(".test.ts"));
  it.each(sources.map((p) => relative(SRC, p)))("%s", (file) => {
    const offending = readFileSync(join(SRC, file), "utf8").split("\n").map((line, i) => [i + 1, line] as const).filter(([, line]) => LITERAL.test(line));
    expect(offending).toEqual([]);
  });
});
