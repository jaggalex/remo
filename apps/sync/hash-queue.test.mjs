import { describe, expect, it } from "vitest";
import { createHashQueue } from "./hash-queue.mjs";

describe("the hash queue", () => {
  it("runs the configured number at once and rejects when the waiting room is full", async () => {
    const queue = createHashQueue({ concurrency: 2, waiting: 1 });
    const started = [];
    const task = (id) =>
      queue.withSlot(async () => {
        started.push(id);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return id;
      });

    const a = task("a");
    const b = task("b");
    const c = task("c");
    await expect(task("d")).rejects.toMatchObject({ code: "HASH_BUSY" });
    expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
    expect(started).toEqual(["a", "b", "c"]);
    expect(queue.stats()).toEqual({ active: 0, waiting: 0 });
  });
});
