/**
 * Guards for the product stylesheet (ADR-078, stage 0.6; ADR-134).
 *
 * The product now paints with @remo/ui tokens. Two mistakes are cheap to make and
 * invisible in review: a literal colour creeping back in, and a `var(--…)` pointing
 * at a token that no longer exists. Both fail here without a browser.
 *
 * The stylesheet is many files behind one entry, so the guard reads every file rather
 * than the entry: a rule that only checked `styles.css` would pass trivially once the
 * entry became a list of imports.
 */
import { describe, expect, it } from "vitest";
import primitive from "../../../packages/ui/src/tokens/primitive.css?raw";
import semantic from "../../../packages/ui/src/tokens/semantic.css?raw";
import component from "../../../packages/ui/src/tokens/component.css?raw";
import light from "../../../packages/ui/src/tokens/themes/light.css?raw";

const modules = import.meta.glob("./styles/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const css = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, text]) => text)
  .join("\n");

const tokenFiles = [primitive, semantic, component, light];

describe("product styles", () => {
  it("is split into files the size ratchet can see", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(1);
  });

  it("has no colour literals — colours come from @remo/ui tokens", () => {
    const literals = css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/gi) ?? [];
    expect(literals).toEqual([]);
  });

  it("uses only tokens that exist in @remo/ui or in its own alias block", () => {
    const declared = new Set([
      ...[...tokenFiles.join("\n").matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
      ...[...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    ]);
    const used = [...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]!);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });
});
