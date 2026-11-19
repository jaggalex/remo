#!/usr/bin/env node
/**
 * Local preview of the built guide (ADR-099).
 *
 * In production nginx serves `docs-site/` under `/guide/`, so the generated pages use
 * absolute `/guide/...` links. This server reproduces that prefix exactly, which is why
 * a plain file server over `docs-site/` would show a page with dead navigation.
 *
 *   pnpm guide:build && pnpm guide:serve
 *   http://localhost:8088/guide/ru/overview/index.html
 *
 * No dependencies and no build step: this is for looking at the documentation, not a
 * second way to publish it.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../docs-site", import.meta.url));
const PORT = Number(process.env.PORT ?? process.argv.find((arg) => arg.startsWith("--port="))?.slice(7) ?? 8088);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

async function file(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/** Start the static server; the audit imports this, the CLI calls it below. */
export function startGuideServer(port = 0) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/" || url.pathname === "/guide") {
      response.writeHead(302, { Location: "/guide/ru/overview/index.html" });
      response.end();
      return;
    }
    if (!url.pathname.startsWith("/guide/")) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("The guide lives under /guide/.\n");
      return;
    }

    const relative = normalize(decodeURIComponent(url.pathname.slice("/guide/".length)));
    if (relative.startsWith("..") || relative.includes(`..${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }

    const candidates = [
      join(ROOT, relative),
      join(ROOT, `${relative}.html`),
      join(ROOT, relative, "index.html"),
    ];

    for (const candidate of candidates) {
      const body = await file(candidate);
      if (!body) continue;
      response.writeHead(200, {
        "Content-Type": TYPES[extname(candidate)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Not found: ${url.pathname}\nСначала соберите портал: pnpm guide:build\n`);
});

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, root: ROOT });
    });
  });
}

// A module import (the audit) must not start a listener by itself.
if (process.argv[1] && process.argv[1].endsWith("guide-serve.mjs")) {
  startGuideServer(PORT).then(({ port }) => {
    console.log(`guide: http://localhost:${port}/guide/ru/overview/index.html`);
    console.log(`guide: ${ROOT}`);
  });
}
