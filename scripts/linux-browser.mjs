/**
 * The one browser the visual baselines are compared in (ADR-222).
 *
 * Chromium runs inside the official Playwright image, pinned to the version of
 * `@playwright/test`, as linux/amd64 on every machine, so a laptop and CI render the same
 * pixels. The tests stay on the host and connect over a websocket; the page reaches the
 * host's servers through Playwright's `exposeNetwork`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function playwrightVersion() {
  const path = require.resolve("@playwright/test/package.json");
  return JSON.parse(readFileSync(path, "utf8")).version;
}

export function linuxBrowserImage(version = playwrightVersion()) {
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", ...options });

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // run-server answers plain HTTP on its port before it accepts the websocket.
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`the Linux browser did not start on :${port} within ${timeoutMs / 1000}s`);
}

/** Start the container; returns the websocket endpoint and a stop function. */
export async function startLinuxBrowser({ port = 3790, name = `remo-linux-browser-${process.pid}` } = {}) {
  const version = playwrightVersion();
  const image = linuxBrowserImage(version);
  if (docker(["image", "inspect", image]).status !== 0) {
    throw new Error(`${image} is not pulled; run: docker pull --platform linux/amd64 ${image}`);
  }
  const started = docker([
    "run", "-d", "--rm", "--init", "--platform", "linux/amd64",
    "--name", name, "-p", `127.0.0.1:${port}:3000`,
    "--workdir", "/home/pwuser", "--user", "pwuser",
    image, "/bin/sh", "-c", `npx -y playwright@${version} run-server --port 3000 --host 0.0.0.0`,
  ]);
  if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr.trim()}`);
  const stop = () => docker(["stop", "-t", "2", name]);
  try {
    await waitForServer(port, 180_000);
  } catch (error) {
    const logs = docker(["logs", name]);
    stop();
    throw new Error(`${error.message}\n${logs.stdout}${logs.stderr}`);
  }
  return { wsEndpoint: `ws://127.0.0.1:${port}/`, stop };
}
