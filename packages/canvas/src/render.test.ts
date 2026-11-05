import { describe, expect, it, vi } from "vitest";
import type { Widget } from "@remo/model";
import { drawWidget } from "./render";

/**
 * A 2D context stand-in: every method is a recorded no-op, every property is writable,
 * and the methods named in `failing` throw — the way a painter fails on a value it did
 * not expect.
 */
function fakeContext(failing: string[] = []) {
  const calls: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (..._args: unknown[]) => {
        calls.push(String(key));
        if (failing.includes(String(key))) throw new Error(`${String(key)} failed`);
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

const shape: Widget = {
  id: "s1",
  type: "unsupported",
  parentId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

describe("drawWidget isolation (ADR-171)", () => {
  it("keeps one failing widget from breaking the frame", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, calls } = fakeContext(["strokeRect"]);

    expect(() => drawWidget(ctx, shape, 1)).not.toThrow();
    // The canvas state is restored, so the next widget paints with a clean context.
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");

    // Reported once per object, not once per frame.
    drawWidget(ctx, shape, 1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("paints a healthy widget inside one save/restore pair", () => {
    const { ctx, calls } = fakeContext();
    drawWidget(ctx, shape, 1);
    expect(calls.filter((c) => c === "save").length).toBe(
      calls.filter((c) => c === "restore").length,
    );
    expect(calls).toContain("strokeRect");
  });
});
