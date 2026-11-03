import { describe, expect, it } from "vitest";
import {
  PlanError,
  USER_STORY_MAP,
  buildStructurePlan,
  estimatePlan,
  planBounds,
  validatePlan,
} from "./index.mjs";

/**
 * The story map is laid out from remo's own geometry, not from taste (ADR-142, ADR-158).
 * These tests pin the constants a generated plan uses — they are our layout for an
 * arbitrary number of columns and swimlanes, independent of the authored template.
 */

function columns(count, stories) {
  return Array.from({ length: count }, (_, column) => ({
    title: `Activity ${column + 1}`,
    stories: Array.from({ length: stories }, (_, row) => `Story ${column + 1}.${row + 1}`),
  }));
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof PlanError ? error.code : `unexpected:${error.message}`;
  }
}

function objectsOf(plan, type) {
  return plan.objects.filter((object) => object.type === type);
}

describe("the user story map keeps the template's geometry (ADR-142)", () => {
  it("is deterministic and counts frames, headers and stories", () => {
    const plan = buildStructurePlan(
      "user-story-map",
      { columns: columns(6, 2) },
      { x: 100, y: 50 },
    );
    const again = buildStructurePlan(
      "user-story-map",
      { columns: columns(6, 2) },
      { x: 100, y: 50 },
    );

    expect(again).toEqual(plan);
    expect(plan.template).toBe("user-story-map");
    expect(plan.counts).toEqual({
      objects: 2 + 6 + 12,
      connectors: 0,
      placements: 0,
      actions: 20,
      byType: { frame: 2, text: 6, sticky_note: 12 },
    });
  });

  it("places stories on the measured pitch and inside their lane", () => {
    const plan = buildStructurePlan("user-story-map", { columns: columns(6, 3) });
    const [header, lane] = objectsOf(plan, "frame");
    const stories = objectsOf(plan, "sticky_note");
    const firstColumn = stories
      .filter((story) => story.tempId.startsWith("tmp_sticky_c1_"))
      .sort((a, b) => a.y - b.y);

    expect(header.tempId).toBe("tmp_header");
    expect(header.height).toBe(USER_STORY_MAP.headerHeight);
    expect(lane.height).toBeCloseTo(3 * USER_STORY_MAP.laneRowHeight, 6);
    expect(firstColumn).toHaveLength(3);
    expect(firstColumn[1].y - firstColumn[0].y).toBeCloseTo(USER_STORY_MAP.pitchY, 6);
    expect(firstColumn[0].width).toBeCloseTo(USER_STORY_MAP.stickyWidth, 6);
    expect(firstColumn[0].height).toBeCloseTo(USER_STORY_MAP.stickyHeight, 6);
    expect(stories.every((story) => story.parentRef === lane.tempId)).toBe(true);

    const halfWidth = lane.width / 2;
    const halfHeight = lane.height / 2;
    for (const story of stories) {
      expect(Math.abs(story.x - lane.x) + story.width / 2).toBeLessThanOrEqual(halfWidth + 1e-9);
      expect(Math.abs(story.y - lane.y) + story.height / 2).toBeLessThanOrEqual(halfHeight + 1e-9);
    }

    // The column header sits above the lane and inside the header frame.
    const headers = objectsOf(plan, "text").filter((text) => text.parentRef === header.tempId);
    expect(headers).toHaveLength(6);
    expect(headers[0].x - stories[0].x).toBe(0);
  });

  it("does not overlap stickers or header texts", () => {
    const plan = buildStructurePlan("user-story-map", { columns: columns(8, 6),
      swimlanes: [
        { title: "Release 1", rows: 2 },
        { title: "Release 2", rows: 2 },
        { title: "Release 3", rows: 2 },
      ],
    });
    const estimate = estimatePlan(plan);

    expect(estimate.warnings.filter((warning) => warning.code === "OVERLAP")).toEqual([]);
    expect(estimate.connectors).toBe(0);
    expect(estimate.byType).toEqual({ frame: 4, text: 8 + 3, sticky_note: 48 });
  });

  it("builds one frame per swimlane plus a header", () => {
    const plan = buildStructurePlan("user-story-map", {
      title: "Team story map",
      columns: columns(8, 5),
      swimlanes: [
        { title: "User persona" },
        { title: "User activities" },
        { title: "User tasks" },
        { title: "Release 1" },
        { title: "Release 2" },
      ],
    });
    const frames = objectsOf(plan, "frame");
    const texts = objectsOf(plan, "text");

    expect(frames).toHaveLength(6);
    expect(frames[0].tempId).toBe("tmp_header");
    // A map title, eight column titles and five lane labels.
    expect(texts).toHaveLength(1 + 8 + 5);
    // Every story has a parent and each frame has at least one child.
    expect(objectsOf(plan, "sticky_note").every((story) => story.parentRef)).toBe(true);
  });

  it("puts a story in the lane that owns its row", () => {
    const plan = buildStructurePlan("user-story-map", {
      columns: columns(2, 3),
      swimlanes: [
        { title: "Release 1", rows: 2 },
        { title: "Release 2", rows: 1 },
      ],
    });
    const stories = objectsOf(plan, "sticky_note");

    expect(stories).toHaveLength(6);
    expect(stories.filter((story) => story.tempId.endsWith("_r1")).every((s) => s.parentRef === "tmp_lane_1")).toBe(true);
    expect(stories.filter((story) => story.tempId.endsWith("_r2")).every((s) => s.parentRef === "tmp_lane_1")).toBe(true);
    expect(stories.filter((story) => story.tempId.endsWith("_r3")).every((s) => s.parentRef === "tmp_lane_2")).toBe(true);
    // A one-row lane is the template's 225.9 tall band.
    expect(objectsOf(plan, "frame")[2].height).toBe(USER_STORY_MAP.laneRowHeight);
  });

  it("extends the last lane instead of dropping overflowing stories", () => {
    const plan = buildStructurePlan("user-story-map", {
      columns: columns(2, 4),
      swimlanes: [{ title: "Release 1" }, { title: "Release 2" }],
    });
    const warning = plan.warnings.find((entry) => entry.code === "STORIES_EXCEED_LANES");

    expect(warning).toBeTruthy();
    expect(warning.message).toMatch(/extended by 2 row/);
    expect(objectsOf(plan, "sticky_note")).toHaveLength(8);
    expect(objectsOf(plan, "frame")[2].height).toBeCloseTo(3 * USER_STORY_MAP.laneRowHeight, 6);
  });

  it("warns about an empty column without refusing the map", () => {
    const plan = buildStructurePlan("user-story-map", {
      columns: [
        { title: "Has stories", stories: ["one"] },
        { title: "Empty", stories: [] },
      ],
    });
    expect(plan.warnings.map((warning) => warning.code)).toContain("EMPTY_COLUMN");
  });

  it("bounds the plan by its boxes", () => {
    const plan = buildStructurePlan("user-story-map", { columns: columns(3, 1) }, { x: 10, y: 20 });
    const bounds = planBounds(plan.objects);

    expect(bounds).toEqual(plan.bounds);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
    expect(bounds.width).toBeCloseTo(USER_STORY_MAP.labelBand + 3 * USER_STORY_MAP.pitchX, 6);
    expect(bounds.height).toBeCloseTo(
      USER_STORY_MAP.headerHeight + USER_STORY_MAP.laneGap + USER_STORY_MAP.laneRowHeight,
      6,
    );
  });

  it("refuses a template it does not know and malformed content", () => {
    expect(codeOf(() => buildStructurePlan("kanban", { columns: columns(1, 1) }))).toBe("BAD_STRUCTURE");
    expect(codeOf(() => buildStructurePlan("user-story-map", { columns: [] }))).toBe("BAD_COLUMNS");
    expect(codeOf(() => buildStructurePlan("user-story-map", { columns: columns(13, 1) }))).toBe("BAD_COLUMNS");
    expect(
      codeOf(() => buildStructurePlan("user-story-map", { columns: [{ title: "", stories: [] }] })),
    ).toBe("BAD_COLUMNS");
    expect(
      codeOf(() =>
        buildStructurePlan("user-story-map", {
          columns: columns(1, 1),
          swimlanes: [{ title: "Lane", rows: 5 }],
        }),
      ),
    ).toBe("BAD_SWIMLANES");
  });

  it("refuses a structure above the object ceiling", () => {
    expect(codeOf(() => buildStructurePlan("user-story-map", { columns: columns(12, 50) }))).toBe(
      "PLAN_TOO_LARGE",
    );
  });

  it("passes the shared validator the client applies", () => {
    const plan = buildStructurePlan("user-story-map", {
      title: "Team story map",
      columns: columns(8, 6),
      swimlanes: [
        { title: "User persona" },
        { title: "User activities and their tasks", rows: 2 },
        { title: "Release 1", rows: 2 },
      ],
    });
    expect(() => validatePlan(plan)).not.toThrow();
  });
});
