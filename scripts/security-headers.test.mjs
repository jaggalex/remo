/**
 * The security headers stay in step with what they protect (ADR-172).
 *
 * The policy lives in two nginx snippets; three things can silently undo it, and each is
 * checked here rather than on a production host:
 *
 * - a location with its own `add_header` that forgets the include (nginx then sends none
 *   of the server's headers for that location);
 * - the guide's inline theme script changing without its CSP hash;
 * - an inline script creeping back into the app shell, which `script-src 'self'` blocks.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${ROOT}${path}`, "utf8");

const APP_SNIPPET = read("deploy/nginx-security-headers.conf");
const SUPPORT_TEMPLATE = read("deploy/nginx-security-headers-support.conf");
const DOCS_SNIPPET = read("deploy/nginx-security-headers-docs.conf");

function csp(snippet) {
  const match = snippet.match(/add_header Content-Security-Policy "([^"]+)"/);
  if (!match) throw new Error("no Content-Security-Policy in snippet");
  return Object.fromEntries(
    match[1].split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

/** `location … { … }` bodies; the shipped configs never nest braces inside a location. */
function locations(config) {
  return [...config.matchAll(/location\s+[^{]+\{([^{}]*)\}/g)].map((match) => match[0]);
}

describe("app policy", () => {
  const policy = csp(APP_SNIPPET);

  it("allows scripts from this origin only", () => {
    expect(policy["script-src"]).toEqual(["'self'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
  });

  it("reaches the live socket on the same host", () => {
    expect(policy["connect-src"]).toContain("wss://$host");
  });

  it("ships the companion headers, on error responses too", () => {
    for (const header of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
    ]) {
      expect(APP_SNIPPET).toMatch(new RegExp(`add_header ${header} "[^"]+" always;`));
      expect(DOCS_SNIPPET).toMatch(new RegExp(`add_header ${header} "[^"]+" always;`));
    }
  });

  it("is not defeated by an inline script in the app shell", () => {
    const html = read("apps/web/index.html");
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].map((tag) => tag[0]);
    expect(inline).toEqual([]);
  });
});

describe("support policy (ADR-250)", () => {
  it("frames nothing in the default and link modes", () => {
    expect(csp(APP_SNIPPET)["frame-src"]).toBeUndefined();
  });

  it("names exactly one origin in the chatwoot variant", () => {
    const policy = csp(SUPPORT_TEMPLATE);
    // The template is rendered per installation; one placeholder is the whole difference.
    expect(policy["frame-src"]).toEqual(["__SUPPORT_ORIGIN__"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["script-src"]).toEqual(["'self'"]);
    // A second framed origin would quietly widen what the app embeds.
    const policyLine = SUPPORT_TEMPLATE.split("\n").find((line) =>
      line.trimStart().startsWith("add_header Content-Security-Policy"),
    );
    expect(policyLine?.match(/frame-src/g)).toHaveLength(1);
  });

  it("renders the support origin into a copy of the policy", () => {
    const directory = mkdtempSync(join(tmpdir(), "remo-headers-"));
    const output = join(directory, "nginx-security-headers.conf");
    try {
      const rendered = spawnSync(
        "bash",
        [
          "-c",
          '. "$1"; render_support_headers "$2" "$3"',
          "render",
          `${ROOT}deploy/config.sh`,
          "https://support.example.com",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(rendered.status, rendered.stderr).toBe(0);
      const policy = csp(readFileSync(output, "utf8"));
      expect(policy["frame-src"]).toEqual(["https://support.example.com"]);
      expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses a support origin that is not a bare https origin", () => {
    const directory = mkdtempSync(join(tmpdir(), "remo-headers-"));
    try {
      for (const origin of ["http://support.example.com", "https://support.example.com/widget"]) {
        const rendered = spawnSync(
          "bash",
          [
            "-c",
            '. "$1"; render_support_headers "$2" "$3"',
            "render",
            `${ROOT}deploy/config.sh`,
            origin,
            join(directory, "headers.conf"),
          ],
          { encoding: "utf8" },
        );
        expect(rendered.status, origin).not.toBe(0);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("guide policy", () => {
  it("carries the hash of the generator's inline theme script", () => {
    const source = read("scripts/guide-build.mjs");
    const script = source.match(/<script>(try\{var t=localStorage\.getItem\("guide\.theme"\).*?)<\/script>/);
    expect(script, "guide-build.mjs no longer writes the inline theme script").toBeTruthy();
    const hash = createHash("sha256").update(script[1], "utf8").digest("base64");
    expect(csp(DOCS_SNIPPET)["script-src"]).toContain(`'sha256-${hash}'`);
  });
});

describe("nginx configs include the policy wherever nginx would drop it", () => {
  const configs = {
    "deploy/nginx-remo.conf": read("deploy/nginx-remo.conf"),
    "deploy/nginx.container.conf": read("deploy/nginx.container.conf"),
    "deploy/nginx-remo-agents.conf": read("deploy/nginx-remo-agents.conf"),
  };

  for (const [path, config] of Object.entries(configs)) {
    it(`${path}: every location with its own add_header includes a snippet`, () => {
      const missing = locations(config).filter(
        (block) => /\badd_header\b/.test(block) && !/include\s+\S*security-headers/.test(block),
      );
      expect(missing).toEqual([]);
    });

    it(`${path}: every server block includes a snippet`, () => {
      const servers = config.split(/^server\s*\{/m).slice(1);
      for (const server of servers) {
        // A plain redirect to HTTPS has nothing to protect.
        if (/^\s*listen 80;/m.test(server) && /return 301 https/.test(server)) continue;
        expect(server).toMatch(/include\s+\S*security-headers/);
      }
    });
  }

  it("the image installs the snippets where the container config includes them", () => {
    const dockerfile = read("deploy/Dockerfile");
    const container = configs["deploy/nginx.container.conf"];
    for (const included of container.matchAll(/include\s+(\/etc\/nginx\/snippets\/\S+);/g)) {
      expect(dockerfile).toContain(` ${included[1]}`);
    }
  });
});
