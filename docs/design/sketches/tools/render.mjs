// Export one sketch series to PNG for hand-off: docs/design/sketches/<series>/*.dc.html →
// docs/design/visual/<series>/<name>.png at 2× (2880 × 1800 for a 1440 × 900 frame).
// Usage from the repo root: node docs/design/sketches/tools/render.mjs <series> [filter] [--scale=1]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2);
const scale = Number((args.find((a) => a.startsWith("--scale=")) || "--scale=2").slice(8));
const [series, only] = args.filter((a) => !a.startsWith("--"));
if (!series) throw new Error("usage: render.mjs <series> [filter] [--scale=1]");
const dir = path.join(root, "docs/design/sketches", series);
const out = path.join(root, "docs/design/visual", series);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".dc.html") && (!only || f.includes(only)));
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  const size = src.match(/"\$preview":\{"width":(\d+),"height":(\d+)\}/);
  const [width, height] = size ? [Number(size[1]), Number(size[2])] : [1440, 900];
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  // A .dc.html frame is markup inside <x-dc>, with its head in <helmet>; render just that.
  const head = (src.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ""])[1];
  const body = (src.match(/<x-dc>[\s\S]*?<\/helmet>([\s\S]*?)<\/x-dc>/) || [, ""])[1];
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${head}</head><body style="margin:0">${body}</body></html>`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(out, f.replace(".dc.html", ".png")) });
  await page.close();
}
await browser.close();
console.log(`${files.length} PNG → ${path.relative(root, out)} at ${scale}×`);
