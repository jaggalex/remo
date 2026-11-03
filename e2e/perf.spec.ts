import { expect, test } from "@playwright/test";

/**
 * A frame budget, measured on the same harness the painters use (roadmap Q2.3).
 *
 * 60 notes and 120 connectors, one note moving every frame. The canvas is deliberately
 * smaller than the manual 1440×900 target; this gate catches a painter regression, not
 * the absolute speed of a laptop.
 */
test("120 connectors stay inside the frame budget", async ({ page }) => {
  await page.goto("/__ds?view=perf&lang=en");
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>).__connectorPerf),
    undefined,
    { timeout: 30_000 },
  );
  const measured = (await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__connectorPerf,
  )) as { fps: number; average: number; worst: number };

  console.log("connector perf", measured);
  // `fps` is reported for context, not asserted: a shared CI runner can throttle
  // requestAnimationFrame independently of paint time (42.8 fps with a 5.7 ms average
  // was observed on GitHub). The frame budget is the signal that catches a painter
  // regression, so assert that and leave the scheduler to the runner.
  expect(measured.average).toBeLessThan(16);
  expect(measured.worst).toBeLessThan(80);
});
