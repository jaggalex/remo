/**
 * Deterministic stand-in for the model in browser acceptance runs.
 *
 * A plan is the one thing an e2e scenario cannot get from a real provider: the answer
 * must be the same on every run, cost nothing and never leave the machine. The fake is
 * therefore gated twice — `REMO_AI_FAKE=plan` alone is not enough; the process must also
 * be an e2e run (`REMO_E2E_RUN_ID`) and must not be production. `pnpm e2e` sets both.
 */

export const FAKE_PLAN_MODEL = "fake/plan";

/**
 * A marker a scenario puts in the brief to get the fixture below.
 *
 * The plan validator refuses a centre outside ±1 000 000, but a box may still reach
 * past the edge when its width is added to a centre on the limit. That is exactly the
 * `PLAN_OUT_OF_BOUNDS` warning the preview must treat as critical, so the fixture is a
 * valid plan that a person must not be allowed to apply.
 */
export const FAKE_OUT_OF_BOUNDS_MARKER = "FAKE_PLAN_OUT_OF_BOUNDS";

/**
 * A fixture with two objects and one line, for the scenarios that need a connector.
 *
 * Geometry is fixed: the notes are 320 apart, so the miniature must draw exactly one
 * line between their centres and applying the plan must create exactly one connector
 * (ADR-142, M3).
 */
export const FAKE_CONNECTED_MARKER = "FAKE_PLAN_CONNECTED";

export function fakeOutOfBoundsReply() {
  return {
    operations: [
      {
        op: "create_widgets",
        objects: [
          {
            tempId: "note_safe",
            type: "sticky_note",
            x: 0,
            y: 0,
            width: 161.2,
            height: 184.7,
            text: "Inside the canvas",
          },
          {
            tempId: "note_far",
            type: "sticky_note",
            x: 1_000_000,
            y: 0,
            width: 200,
            height: 120,
            text: "Past the edge",
          },
        ],
      },
    ],
  };
}

/** Two notes and a line: the smallest plan that exercises the connector path. */
export function fakeConnectedReply() {
  return {
    operations: [
      {
        op: "create_widgets",
        objects: [
          {
            tempId: "note_start",
            type: "sticky_note",
            x: 0,
            y: 0,
            width: 161.2,
            height: 184.7,
            text: "Brief",
          },
          {
            tempId: "note_end",
            type: "sticky_note",
            x: 320,
            y: 0,
            width: 161.2,
            height: 184.7,
            text: "Result",
          },
        ],
      },
      {
        op: "create_connector",
        tempId: "link",
        from: "note_start",
        to: "note_end",
        arrow: "end",
      },
    ],
  };
}

/** A marker a scenario puts in a note to get named tidy blocks. */
export const FAKE_TIDY_MARKER = "FAKE_TIDY_LABELS";

/**
 * The tidy reading: the fake parses the selection block and names one or two blocks.
 * It is deliberately dumb — the real engine computes the layout, the fake only labels.
 */
export function fakeTidyReply(prompt = "") {
  const text = String(prompt);
  const start = text.indexOf("<selection");
  const open = text.indexOf(">", start);
  const close = text.indexOf("</selection>", open);
  let objects = [];
  if (start >= 0 && open > start && close > open) {
    try {
      const parsed = JSON.parse(text.slice(open + 1, close));
      objects = Array.isArray(parsed?.objects) ? parsed.objects : [];
    } catch {
      objects = [];
    }
  }
  const ids = objects.map((object) => String(object.id ?? "")).filter(Boolean);
  if (!ids.length) return { strategy: "prefix", blocks: [{ label: "All", ids: [] }] };
  if (text.includes(FAKE_TIDY_MARKER) && ids.length > 1) {
    const half = Math.ceil(ids.length / 2);
    return {
      strategy: "meaning",
      blocks: [
        { label: "Billing", ids: ids.slice(0, half) },
        { label: "Flow", ids: ids.slice(half) },
      ],
    };
  }
  // Without the marker the fake only confirms that a model answered; the strategy
  // stays `prefix`, which is the deterministic reading an e2e can assert exactly.
  return { strategy: "prefix", blocks: [{ label: "All", ids }] };
}

/** The story map every fake reply proposes. Geometry is computed by the real planner. */
export function fakePlanReply(prompt = "") {
  const brief = String(prompt);
  if (brief.includes(FAKE_OUT_OF_BOUNDS_MARKER)) {
    return fakeOutOfBoundsReply();
  }
  if (brief.includes(FAKE_CONNECTED_MARKER)) {
    return fakeConnectedReply();
  }
  return {
    operations: [
      {
        op: "create_structure",
        template: "user-story-map",
        title: "Checkout",
        columns: [
          { title: "Browse", stories: ["See a product", "Add to cart"] },
          { title: "Pay", stories: ["Choose a card", "Confirm"] },
        ],
        swimlanes: [{ title: "Customer", rows: 2 }],
      },
    ],
  };
}

/** The provider shape `callAgentModel` expects, with no network and no key. */
export function fakePlanClient() {
  return {
    configured: true,
    model: FAKE_PLAN_MODEL,
    baseUrl: "fake://plan",
    async chatJson({ system = "", user = "" } = {}) {
      const tidy = String(system).includes("group whiteboard objects");
      const json = tidy ? fakeTidyReply(user) : fakePlanReply(user);
      return {
        json,
        text: JSON.stringify(json),
        model: FAKE_PLAN_MODEL,
        requestId: null,
        usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
      };
    },
  };
}

/**
 * Is the fake allowed in this process?
 *
 * Both flags must be present. A production process refuses even when an operator sets
 * them by hand, so a misconfigured deployment cannot silently lose its model.
 */
export function fakeModelEnabled(env = process.env) {
  if (env.NODE_ENV === "production") return false;
  if (env.REMO_AI_FAKE !== "plan") return false;
  return Boolean(env.REMO_E2E_RUN_ID);
}
