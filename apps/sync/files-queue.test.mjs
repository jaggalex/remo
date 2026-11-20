import { describe, expect, it } from "vitest";
import { createFilesQueue } from "./files-queue.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the file processing queue", () => {
  it("keeps the active count at the limit and refuses work when full", async () => {
    const queue = createFilesQueue({ concurrency: 2, waiting: 2 });
    let active = 0;
    let peak = 0;

    const task = (id) =>
      queue.withSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(10);
        active -= 1;
        return id;
      });

    const accepted = [task("a"), task("b"), task("c"), task("d")];
    await expect(task("e")).rejects.toMatchObject({ code: "busy", status: 503 });

    expect(await Promise.all(accepted)).toEqual(["a", "b", "c", "d"]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(queue.stats()).toEqual({ active: 0, waiting: 0 });
  });

  it("drains the waiting room in order", async () => {
    const queue = createFilesQueue({ concurrency: 1, waiting: 2 });
    const order = [];
    const task = (id) =>
      queue.withSlot(async () => {
        order.push(id);
        await sleep(5);
        return id;
      });

    await Promise.all([task("a"), task("b"), task("c")]);
    expect(order).toEqual(["a", "b", "c"]);
  });
});
