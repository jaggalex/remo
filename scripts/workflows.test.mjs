/**
 * An action is code that runs with the repository token.
 *
 * A tag can be moved; a full commit SHA cannot. Dependabot updates the pin, and the
 * pin is what a reviewer can compare against the action's own release.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = join(fileURLToPath(new URL("..", import.meta.url)), ".github", "workflows");

describe("GitHub Actions supply chain", () => {
  it("pins every action to a full commit SHA", () => {
    for (const file of readdirSync(DIR)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const text = readFileSync(join(DIR, file), "utf8");
      for (const match of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        expect(match[1], file).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }
    }
  });
});
