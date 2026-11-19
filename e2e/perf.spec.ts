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

/**
 * A drag paints once per frame, not once per pointer event (ADR-213 step 1).
 *
 * The preview is coalesced through `requestAnimationFrame`; without it a 120 Hz pointer
 * asks for 120 board repaints a second. The assertion is a ceiling, not a benchmark: one
 * paint per frame at 70 Hz plus a small margin for the first and last frames.
 */
test("a drag costs one paint per frame, not one per pointer event", async ({ page }) => {
  const { freshBoard, addSticky } = await import("./helpers");
  await freshBoard(page, "perf-drag");
  await addSticky(page);

  const view = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ type: string; x: number; y: number }>;
      };
    }).__remo;
    const note = probe.widgets.find((widget) => widget.type === "sticky_note");
    if (!note) throw new Error("no sticky note");
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      note: { x: note.x, y: note.y },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });

  const centre = {
    x: view.rect.left + view.rect.width / 2 + (view.note.x - view.camera.x) * view.camera.zoom,
    y: view.rect.top + view.rect.height / 2 + (view.note.y - view.camera.y) * view.camera.zoom,
  };

  const stats = () =>
    page.evaluate(() => {
      const probe = (window as unknown as {
        __remo: { paintStats: { board: number } };
      }).__remo;
      return { paints: probe.paintStats.board, time: performance.now() };
    });

  const before = await stats();
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 260, centre.y + 180, { steps: 120 });
  await page.mouse.up();
  const after = await stats();

  const moves = 120;
  const paints = after.paints - before.paints;
  const elapsedMs = after.time - before.time;
  const ceiling = Math.ceil((elapsedMs / 1000) * 70) + 3;
  console.log("drag paints", { moves, paints, elapsedMs: Math.round(elapsedMs), ceiling });
  // One paint per frame at the pointer's pace.
  expect(paints).toBeLessThanOrEqual(ceiling);

  // Now a burst: 120 moves inside one task, far faster than a frame. The coalescer must
  // turn them into a couple of paints, not 120.
  const burst = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ type: string; x: number; y: number }>;
        paintStats: { board: number };
      };
    }).__remo;
    const note = probe.widgets.find((widget) => widget.type === "sticky_note");
    if (!note) throw new Error("no sticky note");
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (note.x - probe.camera.x) * probe.camera.zoom;
    const y = rect.top + rect.height / 2 + (note.y - probe.camera.y) * probe.camera.zoom;
    const before = probe.paintStats.board;
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    const fire = (type: string, atX: number, atY: number, buttons: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: atX,
          clientY: atY,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: type === "pointermove" ? -1 : 0,
          buttons,
        }),
      );
    fire("pointerdown", x, y, 1);
    for (let index = 1; index <= 120; index += 1) {
      fire("pointermove", x + index, y + index / 2, 1);
    }
    fire("pointerup", x + 120, y + 60, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { paints: probe.paintStats.board - before, moves: 120 };
  });
  console.log("burst paints", burst);
  expect(burst.paints).toBeLessThan(10);
});
