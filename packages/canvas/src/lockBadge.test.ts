import { describe, expect, it } from "vitest";
import { drawLockBadge, lockBadgeRect, LOCK_BADGE_MARGIN, LOCK_BADGE_SIZE } from "./lockBadge";

function fakeContext() {
  const calls: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (..._args: unknown[]) => {
        calls.push(String(key));
        return undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("lockBadgeRect (ADR-193)", () => {
  it("keeps a 16 px badge four px inside the top-right corner at zoom 1", () => {
    expect(lockBadgeRect({ x: 0, y: 0, width: 100, height: 80 }, 1)).toEqual({
      x: 100 - LOCK_BADGE_SIZE - LOCK_BADGE_MARGIN,
      y: LOCK_BADGE_MARGIN,
      width: LOCK_BADGE_SIZE,
      height: LOCK_BADGE_SIZE,
    });
  });

  it("keeps the badge the same screen size when the camera zooms in", () => {
    const rect = lockBadgeRect({ x: 0, y: 0, width: 100, height: 80 }, 2);
    expect(rect.width).toBe(LOCK_BADGE_SIZE / 2);
    expect(rect.height).toBe(LOCK_BADGE_SIZE / 2);
    expect(rect.x).toBe(100 - LOCK_BADGE_SIZE / 2 - LOCK_BADGE_MARGIN / 2);
    expect(rect.y).toBe(LOCK_BADGE_MARGIN / 2);
  });

  it("anchors a widget smaller than the badge at its own top-left", () => {
    const rect = lockBadgeRect({ x: 10, y: 20, width: 10, height: 10 }, 1);
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
  });
});

describe("drawLockBadge (ADR-193)", () => {
  it("paints the lock inside one save/restore pair", () => {
    const { ctx, calls } = fakeContext();
    drawLockBadge(ctx, { x: 0, y: 0, width: 16, height: 16 }, "#000");
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");
    expect(calls).toContain("quadraticCurveTo");
    expect(calls).toContain("fill");
    expect(calls).toContain("translate");
    expect(calls).toContain("scale");
  });
});
