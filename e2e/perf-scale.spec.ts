import { expect, test } from "@playwright/test";

/**
 * The 10 000-object paint baseline (review P6).
 *
 * The connector harness (60 notes, 120 lines) catches a painter regression; this one
 * catches the size the product says it supports. It asserts a floor, not a laptop's
 * absolute speed: 30 fps average and no 150 ms frame. The number is printed on every run
 * so a regression is visible before the threshold is reached.
 */
test("10 000 objects stay inside the paint budget", async ({ page }) => {
  await page.goto("/__ds?view=scale&lang=en");
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>).__scalePerf),
    undefined,
    { timeout: 90_000 },
  );
  const measured = (await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__scalePerf,
  )) as { average: number; worst: number; objects: number; visible: number };

  console.log("scale perf", measured);
  expect(measured.objects).toBe(10_000);
  // The product culls to the viewport; the baseline is only meaningful when the camera
  // actually sees a large part of the room.
  expect(measured.visible).toBeGreaterThan(400);
  expect(measured.average).toBeLessThan(16);
  expect(measured.worst).toBeLessThan(80);
});
