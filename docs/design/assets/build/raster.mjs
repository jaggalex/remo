import { chromium } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of readdirSync(`${dir}/cursors`).filter(f => f.startsWith("remo-cursor-") && f.endsWith(".svg"))) {
  const svg = readFileSync(`${dir}/cursors/${f}`, "utf8");
  for (const scale of [1, 2]) {
    await page.setViewportSize({ width: 32 * scale, height: 32 * scale });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="32" height="32"', `width="${32*scale}" height="${32*scale}"`)}</body></html>`);
    await page.screenshot({ path: `${dir}/cursors/${f.replace(".svg", `@${scale}x.png`)}`, omitBackground: true });
  }
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("file://" + process.cwd() + "/" + dir + "/preview.html");
await page.waitForTimeout(800);
await page.screenshot({ path: process.argv[3], fullPage: true });
await browser.close();
console.log("raster ok");
