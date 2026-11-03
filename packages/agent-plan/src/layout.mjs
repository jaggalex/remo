import {
  PLAN_LIMITS,
  PlanError,
  countsOf,
  finiteIn,
  isRecord,
  textField,
} from "./limits.mjs";

/** Bounds of planned boxes; coordinates are absolute and centre-anchored (ADR-001). */
export function planBounds(objects) {
  if (!objects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    minX = Math.min(minX, object.x - object.width / 2);
    minY = Math.min(minY, object.y - object.height / 2);
    maxX = Math.max(maxX, object.x + object.width / 2);
    maxY = Math.max(maxY, object.y + object.height / 2);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Geometry of the user story map, measured from `spec/templates.json`
 * (`user-story-map-basic`), not invented (ADR-142).
 *
 * The reference board is six wide lane frames holding eight sticker columns: a note is
 * 161.2 × 184.7 at a 181.6 horizontal and 194.7 vertical pitch, the label band is
 * 364.1 wide, a one-row lane is 225.9 tall (two rows are 451.8), and lanes are 32 apart.
 * The clone's story map generalises the counts, not the measurements.
 */
export const USER_STORY_MAP = Object.freeze({
  pitchX: 181.6,
  pitchY: 194.7,
  stickyWidth: 161.2,
  stickyHeight: 184.7,
  labelBand: 364.1,
  laneRowHeight: 225.9,
  laneGap: 32,
  headerHeight: 120,
  titleWidth: 617.1,
  titleHeight: 73.1,
  titleGap: 100,
  titleFontSize: 64,
  columnFontSize: 32,
  columnHeaderHeight: 80,
  labelWidth: 208,
  labelLineHeight: 36.6,
  labelPad: 36.2,
});

const TEMPLATE = "user-story-map";

function originOf(origin) {
  if (origin === undefined || origin === null) return { x: 0, y: 0 };
  if (!isRecord(origin)) throw new PlanError("BAD_ORIGIN", "origin must be {x, y}");
  return {
    x: finiteIn(origin.x, -PLAN_LIMITS.coordinate, PLAN_LIMITS.coordinate, "BAD_ORIGIN", "origin.x is out of bounds"),
    y: finiteIn(origin.y, -PLAN_LIMITS.coordinate, PLAN_LIMITS.coordinate, "BAD_ORIGIN", "origin.y is out of bounds"),
  };
}

function object(tempId, type, box, extra = {}) {
  return { tempId, type, ...box, ...extra };
}

function cleanColumns(columns) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > PLAN_LIMITS.columns) {
    throw new PlanError(
      "BAD_COLUMNS",
      `a story map needs 1 to ${PLAN_LIMITS.columns} columns`,
    );
  }
  return columns.map((column, index) => {
    if (!isRecord(column)) throw new PlanError("BAD_COLUMNS", `column ${index + 1} must be an object`);
    const title = textField(column.title, {
      code: "BAD_COLUMNS",
      field: `columns[${index}].title`,
      max: PLAN_LIMITS.titleLength,
      required: true,
    });
    const stories = column.stories ?? [];
    if (!Array.isArray(stories) || stories.length > PLAN_LIMITS.storiesPerColumn) {
      throw new PlanError(
        "BAD_COLUMNS",
        `columns[${index}].stories must be an array of at most ${PLAN_LIMITS.storiesPerColumn} stories`,
      );
    }
    return {
      title,
      stories: stories.map((story, storyIndex) =>
        textField(story, {
          code: "BAD_COLUMNS",
          field: `columns[${index}].stories[${storyIndex}]`,
          max: PLAN_LIMITS.textLength,
          required: true,
        }),
      ),
    };
  });
}

function cleanSwimlanes(swimlanes) {
  if (swimlanes === undefined || swimlanes === null) return null;
  if (!Array.isArray(swimlanes) || swimlanes.length < 1) {
    throw new PlanError("BAD_SWIMLANES", "swimlanes must be a non-empty array when given");
  }
  if (swimlanes.length > PLAN_LIMITS.swimlanes) {
    throw new PlanError("BAD_SWIMLANES", `a story map has at most ${PLAN_LIMITS.swimlanes} swimlanes`);
  }
  return swimlanes.map((lane, index) => {
    if (!isRecord(lane)) throw new PlanError("BAD_SWIMLANES", `swimlane ${index + 1} must be an object`);
    const title = textField(lane.title, {
      code: "BAD_SWIMLANES",
      field: `swimlanes[${index}].title`,
      max: PLAN_LIMITS.titleLength,
      required: true,
    });
    const rows = lane.rows === undefined ? 1 : Number(lane.rows);
    if (!Number.isInteger(rows) || rows < 1 || rows > PLAN_LIMITS.rowsPerSwimlane) {
      throw new PlanError(
        "BAD_SWIMLANES",
        `swimlanes[${index}].rows must be an integer from 1 to ${PLAN_LIMITS.rowsPerSwimlane}`,
      );
    }
    return { title, rows };
  });
}

/**
 * Turn a story-map description into plan objects — no board, no document, no write.
 *
 * The layout is deterministic: the same content and origin always produce the same
 * tempIds and coordinates, which is what makes a plan testable and idempotent. Frames
 * are lanes (header + one per swimlane), column titles are text objects inside the
 * header frame, and stories are sticky notes inside their lane.
 */
export function buildStructurePlan(templateKey, content, origin = { x: 0, y: 0 }) {
  if (templateKey !== TEMPLATE) {
    throw new PlanError(
      "BAD_STRUCTURE",
      `the only structure in M1 is "${TEMPLATE}", got "${String(templateKey)}"`,
    );
  }
  if (!isRecord(content)) throw new PlanError("BAD_STRUCTURE", "structure content must be an object");
  const at = originOf(origin);
  const columns = cleanColumns(content.columns);
  const lanes = cleanSwimlanes(content.swimlanes);
  const title = textField(content.title, {
    code: "BAD_STRUCTURE",
    field: "title",
    max: PLAN_LIMITS.titleLength,
  });

  const warnings = [];
  const maxStories = Math.max(...columns.map((column) => column.stories.length), 0);
  const effectiveLanes = lanes
    ? lanes.map((lane) => ({ ...lane }))
    : [{ title: "", rows: Math.max(1, maxStories) }];

  // A column may carry more stories than the declared lanes have rows. Extending the
  // last lane keeps every story in the plan and makes the overflow a reported warning
  // instead of a silent drop.
  const declaredRows = effectiveLanes.reduce((total, lane) => total + lane.rows, 0);
  if (maxStories > declaredRows) {
    const last = effectiveLanes[effectiveLanes.length - 1];
    last.rows += maxStories - declaredRows;
    warnings.push({
      code: "STORIES_EXCEED_LANES",
      message: `the last swimlane was extended by ${maxStories - declaredRows} row(s) to fit the stories`,
    });
  }
  for (const [index, column] of columns.entries()) {
    if (!column.stories.length) {
      warnings.push({
        code: "EMPTY_COLUMN",
        message: `column ${index + 1} has no stories`,
        column: index + 1,
      });
    }
  }

  const { pitchX, pitchY, stickyWidth, stickyHeight, labelBand, laneRowHeight } = USER_STORY_MAP;
  const left = at.x;
  const mapWidth = Math.max(160, labelBand + columns.length * pitchX);
  const centerX = left + mapWidth / 2;
  const objects = [];
  let cursorY = at.y;

  if (title) {
    objects.push(
      object(
        "tmp_title",
        "text",
        {
          x: centerX,
          y: cursorY + USER_STORY_MAP.titleHeight / 2,
          width: USER_STORY_MAP.titleWidth,
          height: USER_STORY_MAP.titleHeight,
        },
        {
          text: title,
          style: { fontSize: USER_STORY_MAP.titleFontSize, textAlign: "center" },
        },
      ),
    );
    cursorY += USER_STORY_MAP.titleHeight + USER_STORY_MAP.titleGap;
  }

  const headerY = cursorY + USER_STORY_MAP.headerHeight / 2;
  objects.push(
    object("tmp_header", "frame", {
      x: centerX,
      y: headerY,
      width: mapWidth,
      height: USER_STORY_MAP.headerHeight,
    }),
  );
  for (const [columnIndex, column] of columns.entries()) {
    objects.push(
      object(
        `tmp_col_${columnIndex + 1}`,
        "text",
        {
          x: left + labelBand + stickyWidth / 2 + columnIndex * pitchX,
          y: headerY,
          width: stickyWidth,
          height: USER_STORY_MAP.columnHeaderHeight,
        },
        {
          parentRef: "tmp_header",
          text: column.title,
          style: { fontSize: USER_STORY_MAP.columnFontSize, textAlign: "center" },
        },
      ),
    );
  }
  cursorY += USER_STORY_MAP.headerHeight + USER_STORY_MAP.laneGap;

  let rowStart = 0;
  for (const [laneIndex, lane] of effectiveLanes.entries()) {
    const height = lane.rows * laneRowHeight;
    const laneY = cursorY + height / 2;
    const frameId = `tmp_lane_${laneIndex + 1}`;
    objects.push(
      object(frameId, "frame", {
        x: centerX,
        y: laneY,
        width: mapWidth,
        height,
      }),
    );

    if (lane.title) {
      const labelHeight =
        lane.title.length > 20
          ? USER_STORY_MAP.labelLineHeight * 2
          : PLAN_LIMITS.minHeight;
      objects.push(
        object(
          `tmp_label_${laneIndex + 1}`,
          "text",
          {
            x: left + USER_STORY_MAP.labelPad + USER_STORY_MAP.labelWidth / 2,
            y: cursorY + USER_STORY_MAP.labelPad + labelHeight / 2,
            width: USER_STORY_MAP.labelWidth,
            height: labelHeight,
          },
          { parentRef: frameId, text: lane.title, style: { fontSize: USER_STORY_MAP.columnFontSize } },
        ),
      );
    }

    for (const [columnIndex, column] of columns.entries()) {
      for (let row = 0; row < lane.rows; row += 1) {
        const story = column.stories[rowStart + row];
        if (story === undefined) continue;
        objects.push(
          object(
            `tmp_sticky_c${columnIndex + 1}_r${rowStart + row + 1}`,
            "sticky_note",
            {
              x: left + labelBand + stickyWidth / 2 + columnIndex * pitchX,
              y: laneY + (row - (lane.rows - 1) / 2) * pitchY,
              width: stickyWidth,
              height: stickyHeight,
            },
            { parentRef: frameId, text: story },
          ),
        );
      }
    }
    rowStart += lane.rows;
    cursorY += height + USER_STORY_MAP.laneGap;
  }

  const counts = countsOf(objects, []);
  if (counts.objects > PLAN_LIMITS.objects) {
    throw new PlanError(
      "PLAN_TOO_LARGE",
      `the structure needs ${counts.objects} objects; one plan allows ${PLAN_LIMITS.objects}`,
    );
  }

  return {
    version: 1,
    template: TEMPLATE,
    origin: at,
    objects,
    connectors: [],
    counts,
    bounds: planBounds(objects),
    warnings,
  };
}
