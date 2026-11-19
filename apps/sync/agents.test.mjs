import { describe, expect, it } from "vitest";
import {
  AGENT_FORBIDDEN,
  agentEffective,
  aiEntryRefusal,
  budgetMissing,
  normalizeBudget,
  resolveSkill,
  withinBudget,
} from "./agents.mjs";

const ownerAccess = (capabilities = ["board.read", "board.edit"], sources = ["owner"]) => ({
  allowed: true,
  role: "editor",
  capabilities,
  sources,
  reason: "ALLOW",
});

const agent = { id: "a1", state: "active", ownerId: "u1" };
const board = { id: "b1", agentsEnabled: true };
const policy = { agentsEnabled: true };
const task = { id: "t1", status: "running", mode: "write", capabilities: ["board.read", "board.edit"] };

describe("agentEffective", () => {
  it("allows a task inside the owner's rights", () => {
    const result = agentEffective({ agent, ownerAccess: ownerAccess(), board, policy, task });
    expect(result).toMatchObject({ allowed: true, mode: "write" });
    expect(result.capabilities.sort()).toEqual(["board.edit", "board.read"]);
    expect(result.sources).toContain("agent:a1");
    expect(result.sources).toContain("task:t1");
  });

  it("can never be stronger than the owner", () => {
    const result = agentEffective({
      agent,
      ownerAccess: ownerAccess(["board.read"], ["grant:user"]),
      board,
      policy,
      task,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("NO_CAPABILITY");
  });

  it("is deny-overrides at every enablement level", () => {
    expect(
      agentEffective({ agent: { ...agent, state: "disabled" }, ownerAccess: ownerAccess(), board, policy, task }).reason,
    ).toBe("AGENT_DISABLED");
    expect(
      agentEffective({ agent, ownerAccess: ownerAccess(), board, policy: { agentsEnabled: false }, task }).reason,
    ).toBe("AGENTS_DISABLED_ORG");
    expect(
      agentEffective({ agent, ownerAccess: ownerAccess(), board: { agentsEnabled: false }, policy, task }).reason,
    ).toBe("AGENTS_DISABLED_BOARD");
    expect(
      agentEffective({ agent, ownerAccess: { allowed: false, reason: "ORG_SUSPENDED" }, board, policy, task }).reason,
    ).toBe("ORG_SUSPENDED");
    expect(agentEffective({ agent, ownerAccess: ownerAccess(), board, policy }).reason).toBe(
      "TASK_REQUIRED",
    );
  });

  it("refuses capabilities that belong to a human", () => {
    for (const capability of AGENT_FORBIDDEN) {
      const result = agentEffective({
        agent,
        ownerAccess: ownerAccess([...ownerAccess().capabilities, capability]),
        board,
        policy,
        task: { ...task, capabilities: ["board.read", capability] },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("FORBIDDEN_CAPABILITY");
    }
  });

  it("does not allow a read task to write", () => {
    const result = agentEffective({
      agent,
      ownerAccess: ownerAccess(),
      board,
      policy,
      task: { ...task, mode: "read" },
    });
    expect(result.mode).toBe("read");
    expect(result.capabilities).toEqual(["board.read"]);
  });
});

describe("budget", () => {
  it("fills defaults and clamps absurd values", () => {
    expect(normalizeBudget({})).toEqual({
      maxTokens: 8000,
      maxCostUsd: 0.5,
      maxActions: 40,
      maxSeconds: 120,
    });
    const tiny = normalizeBudget({ maxTokens: 1, maxCostUsd: -1, maxActions: 0, maxSeconds: 1 });
    expect(tiny.maxTokens).toBe(256);
    expect(tiny.maxCostUsd).toBe(0);
    expect(tiny.maxActions).toBe(1);
    expect(tiny.maxSeconds).toBe(10);
  });

  it("keeps a fractional dollar budget instead of rounding it to zero", () => {
    // A tenth of a dollar is a real consent; rounding it to 0 would silently forbid the
    // call a person just allowed (ADR-142).
    expect(normalizeBudget({ maxCostUsd: 0.1 }).maxCostUsd).toBe(0.1);
    expect(normalizeBudget({ maxCostUsd: 0.5 }).maxCostUsd).toBe(0.5);
    expect(normalizeBudget({ maxCostUsd: 0.25 }).maxCostUsd).toBe(0.25);
    expect(normalizeBudget({ maxCostUsd: 0.0001 }).maxCostUsd).toBe(0.0001);
    // Float noise from a text field is cut, not carried into the audit.
    expect(normalizeBudget({ maxCostUsd: 0.1 + 0.2 }).maxCostUsd).toBe(0.3);
  });

  it("keeps whole dollars, zero and the limits", () => {
    expect(normalizeBudget({ maxCostUsd: 1 }).maxCostUsd).toBe(1);
    expect(normalizeBudget({ maxCostUsd: 5 }).maxCostUsd).toBe(5);
    expect(normalizeBudget({ maxCostUsd: 0 }).maxCostUsd).toBe(0);
    expect(normalizeBudget({ maxCostUsd: -1 }).maxCostUsd).toBe(0);
    expect(normalizeBudget({ maxCostUsd: 1e9 }).maxCostUsd).toBe(5);
    expect(normalizeBudget({ maxCostUsd: 1e9 }, { maxCostUsd: 2 }).maxCostUsd).toBe(2);
    // Only money is fractional; counts and seconds stay whole.
    expect(normalizeBudget({ maxTokens: 999.6 }).maxTokens).toBe(1000);
    expect(normalizeBudget({ maxActions: 2.4 }).maxActions).toBe(2);
    expect(normalizeBudget({ maxSeconds: 42.6 }).maxSeconds).toBe(43);
  });

  it("refuses a task that never agreed on a budget", () => {
    expect(budgetMissing(undefined)).toBe(true);
    expect(budgetMissing({})).toBe(true);
    expect(budgetMissing({ note: "cheap" })).toBe(true);
    expect(budgetMissing({ maxCostUsd: null })).toBe(true);
    expect(budgetMissing({ maxCostUsd: "" })).toBe(true);
    expect(budgetMissing({ maxActions: 5 })).toBe(false);
    // Zero is a decision ("no money"), not an absent budget.
    expect(budgetMissing({ maxCostUsd: 0 })).toBe(false);
  });

  it("checks tokens, money, actions and time", () => {
    const budget = { maxTokens: 100, maxCostUsd: 0.01, maxActions: 5, maxSeconds: 10 };
    expect(withinBudget(budget, { promptTokens: 60, completionTokens: 40, costUsd: 0.01, actions: 5, seconds: 10 })).toBe(true);
    expect(withinBudget(budget, { promptTokens: 60, completionTokens: 41 })).toBe(false);
    expect(withinBudget(budget, { costUsd: 0.02 })).toBe(false);
    expect(withinBudget(budget, { actions: 6 })).toBe(false);
    expect(withinBudget(budget, { seconds: 11 })).toBe(false);
  });
});

describe("who may ask an agent", () => {
  it("refuses a public-link visitor and a reader, for different reasons", () => {
    expect(aiEntryRefusal({ allowed: true, capabilities: ["board.read"], sources: ["link"] })).toBe(
      "ACCOUNT_REQUIRED",
    );
    expect(
      aiEntryRefusal({ allowed: true, capabilities: ["board.read"], sources: ["grant:user"] }),
    ).toBe("NO_CAPABILITY");
    expect(
      aiEntryRefusal({
        allowed: true,
        capabilities: ["board.read", "board.edit"],
        sources: ["grant:user", "link"],
      }),
    ).toBeNull();
    expect(aiEntryRefusal({ allowed: false, capabilities: [], sources: [] })).toBe("NO_ACCESS");
  });
});

describe("resolveSkill", () => {
  const catalog = [
    { slug: "diagram", state: "published", version: 1 },
    { slug: "cards", state: "published", version: 1 },
    { slug: "brief-to-board", state: "published", version: 1 },
    { slug: "tidy-selection", state: "published", version: 1 },
    { slug: "draft-only", state: "draft", version: 1 },
  ];

  it("prefers an explicit slug among published skills", () => {
    expect(resolveSkill(catalog, { slug: "diagram" }).slug).toBe("diagram");
    expect(resolveSkill(catalog, { slug: "draft-only" })).toBeNull();
  });

  it("matches a diagram intent in both languages", () => {
    expect(resolveSkill(catalog, { intent: "нарисуй схему процесса" }).slug).toBe("diagram");
    expect(resolveSkill(catalog, { intent: "draw a flow chart" }).slug).toBe("diagram");
  });

  it("chooses the brief skill for a story map or an explicit frame", () => {
    expect(resolveSkill(catalog, { intent: "Собери US-карту для оплаты" }).slug).toBe(
      "brief-to-board",
    );
    expect(resolveSkill(catalog, { intent: "Create a user story map" }).slug).toBe(
      "brief-to-board",
    );
    // "Frame with cards" is still a structure: the brief skill owns the frame, cards
    // only converts an existing selection.
    expect(resolveSkill(catalog, { intent: "создай фрейм с задачами" }).slug).toBe(
      "brief-to-board",
    );
    expect(resolveSkill(catalog, { intent: "сделай карточки из выделения" }).slug).toBe("cards");
  });

  it("resolves the tidy intents in both languages", () => {
    for (const intent of [
      "упорядочи выделение",
      "приберись на доске",
      "наведи порядок в заметках",
      "разложи по колонкам",
      "tidy up the selection",
      "arrange these notes",
    ]) {
      expect(resolveSkill(catalog, { intent }).slug).toBe("tidy-selection");
    }
  });

  it("lets an explicit slug win over an intent hint", () => {
    expect(resolveSkill(catalog, { slug: "cards", intent: "US-карта" }).slug).toBe("cards");
  });

  it("returns null when nothing is published", () => {
    expect(resolveSkill([{ slug: "x", state: "draft" }], { intent: "diagram" })).toBeNull();
  });
});
