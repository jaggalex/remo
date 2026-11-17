import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { drawCardMeta } from "./cardMeta";
import { DEFAULT_PALETTE } from "./palette";

/** Records the font in force at every fillText. */
function fonts() {
  const seen: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return () => {
        if (key === "fillText") seen.push(String(target.font));
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, seen };
}

describe("card small print (ADR-235)", () => {
  it("is drawn in world units, so it scales with the card like its title", () => {
    const card = { id: "c", type: "card", status: "in_progress", dueAt: "2026-10-31" } as unknown as Widget;
    const { ctx, seen } = fonts();
    drawCardMeta(ctx, 0, 0, 250, 70, card, {
      fontFamily: "Inter",
      palette: DEFAULT_PALETTE,
      statusLabel: { todo: "To do", in_progress: "In progress", done: "Done" },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const font of seen) expect(font).toMatch(/^9\.5px /);
  });
});
