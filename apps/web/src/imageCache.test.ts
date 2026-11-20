import { describe, expect, it } from "vitest";
import { createImageCache } from "./imageCache";

/** A decoded bitmap stand-in: the cache only needs its size and `close`. */
function bitmap(width = 100, height = 100) {
  const closed = { value: false };
  const value = {
    width,
    height,
    close: () => {
      closed.value = true;
    },
  } as unknown as ImageBitmap;
  return { value, closed };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("image cache (ADR-249, §6)", () => {
  it("deduplicates concurrent requests for the same file and variant", async () => {
    let calls = 0;
    let release!: (value: ImageBitmap | null) => void;
    const cache = createImageCache({
      load: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      maxParallel: 6,
    });
    const first = cache.load("f1", "w1024");
    const second = cache.load("f1", "w1024");
    expect(second).toBe(first);
    expect(calls).toBe(1);
    const picture = bitmap(1024, 512);
    release(picture.value);
    await expect(first).resolves.toBe(picture.value);
    expect(cache.size).toBe(1);
    expect(cache.peek("f1", "w1024")).toBe(picture.value);
  });

  it("evicts the least recently used entry when the budget is full", async () => {
    // 100×100×4 = 40 000 bytes each; a budget of 80 000 holds two.
    const cache = createImageCache({
      load: async (fileId) => bitmap().value,
      budgetBytes: 80_000,
    });
    await cache.load("a", "w256");
    await cache.load("b", "w256");
    await cache.load("c", "w256");
    expect(cache.size).toBe(2);
    expect(cache.peek("a", "w256")).toBeNull();

    // Reading `b` makes it the most recent, so loading `d` drops `c`.
    expect(cache.peek("b", "w256")).not.toBeNull();
    await cache.load("d", "w256");
    expect(cache.size).toBe(2);
    expect(cache.peek("c", "w256")).toBeNull();
    expect(cache.peek("b", "w256")).not.toBeNull();
    expect(cache.bytes).toBeLessThanOrEqual(80_000);
  });

  it("closes an evicted bitmap, so the bound is real memory", async () => {
    const first = bitmap();
    const cache = createImageCache({
      load: async (fileId) => (fileId === "a" ? first.value : bitmap().value),
      budgetBytes: 40_000,
    });
    await cache.load("a", "w256");
    await cache.load("b", "w256");
    expect(first.closed.value).toBe(true);
  });

  it("keeps a bitmap that alone exceeds the budget", async () => {
    const huge = bitmap(1000, 1000);
    const cache = createImageCache({
      load: async () => huge.value,
      budgetBytes: 1,
    });
    await cache.load("big", "w2048");
    expect(cache.size).toBe(1);
    expect(cache.peek("big", "w2048")).toBe(huge.value);
  });

  it("retries a failure at most once per 30 seconds", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createImageCache({
      load: async () => {
        calls += 1;
        return null;
      },
      now: () => now,
    });
    await expect(cache.load("gone", "w256")).resolves.toBeNull();
    expect(calls).toBe(1);
    expect(cache.status("gone", "w256")).toBe("error");

    await expect(cache.load("gone", "w256")).resolves.toBeNull();
    expect(calls).toBe(1);

    now += 29_999;
    await cache.load("gone", "w256");
    expect(calls).toBe(1);

    now += 1;
    await cache.load("gone", "w256");
    expect(calls).toBe(2);
  });

  it("runs no more than six requests at once", async () => {
    const waiting: Array<(value: ImageBitmap | null) => void> = [];
    let started = 0;
    const cache = createImageCache({
      load: () => {
        started += 1;
        return new Promise((resolve) => waiting.push(resolve));
      },
      maxParallel: 6,
    });
    const jobs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      cache.load(id, "w256"),
    );
    await flush();
    expect(started).toBe(6);

    // Finishing one makes room for exactly one more.
    waiting[0]!(bitmap().value);
    await flush();
    expect(started).toBe(7);
    for (let index = 1; index < jobs.length; index += 1) {
      while (!waiting[index]) await flush();
      waiting[index]!(bitmap().value);
      await flush();
    }
    await Promise.all(jobs);
    expect(cache.size).toBe(8);
  });

  it("announces a finished request once, successfully or not", async () => {
    const events: Array<{ fileId: string; ok: boolean }> = [];
    const cache = createImageCache({
      load: async (fileId) => (fileId === "ok" ? bitmap().value : null),
    });
    const off = cache.subscribe((event) => events.push({ fileId: event.fileId, ok: event.ok }));
    await cache.load("ok", "w256");
    await cache.load("bad", "w256");
    off();
    await cache.load("ok", "w1024");
    expect(events).toEqual([
      { fileId: "ok", ok: true },
      { fileId: "bad", ok: false },
    ]);
  });

  it("reports where a key stands, so the painter can choose a placeholder", async () => {
    let release!: (value: ImageBitmap | null) => void;
    const cache = createImageCache({
      load: () => new Promise((resolve) => {
        release = resolve;
      }),
    });
    expect(cache.status("f1", "w1024")).toBe("idle");
    const loading = cache.load("f1", "w1024");
    expect(cache.status("f1", "w1024")).toBe("loading");
    release(bitmap().value);
    await loading;
    expect(cache.status("f1", "w1024")).toBe("ready");
  });
});
