/**
 * The application points of a plan without a database (ADR-247, `spec/billing.md` §2.4).
 *
 * The store double answers each counter from the fixture and records how often it was
 * asked: a limit that is not reached must not cost a query, and the self-host answer
 * must not read a row at all.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetEntitlementCache } from "./billing.mjs";
import {
  agentTaskLimit,
  featureLimit,
  planFeatureResponse,
  planLimitResponse,
  roomLimit,
  seatLimit,
} from "./billing-guard.mjs";

const ORIGINAL_BILLING = process.env.REMO_BILLING;

afterAll(() => {
  if (ORIGINAL_BILLING === undefined) delete process.env.REMO_BILLING;
  else process.env.REMO_BILLING = ORIGINAL_BILLING;
  resetEntitlementCache();
});

beforeEach(() => {
  // The guard reads the setting the way a route does; each file gets its own process.
  process.env.REMO_BILLING = "on";
  resetEntitlementCache();
});

function subscription(plan, status = "active") {
  return {
    id: `sub-${plan}`,
    org_id: "org",
    plan,
    status,
    current_period_start: new Date("2026-11-01T00:00:00Z"),
    current_period_end: new Date("2026-12-01T00:00:00Z"),
  };
}

/** A store double: `withTenant` runs the callback, the counters answer the fixture. */
function fakeStore({
  org = { kind: "shared" },
  plan = null,
  rooms = 0,
  seats = 0,
  tasks = 0,
} = {}) {
  const reads = { rooms: 0, seats: 0, tasks: 0 };
  return {
    reads,
    async withTenant(_orgId, fn) {
      return fn();
    },
    async billingOrg() {
      return org;
    },
    async liveSubscription() {
      return plan ? subscription(plan) : null;
    },
    async activeRoomCount() {
      reads.rooms += 1;
      return rooms;
    },
    async seatUsage() {
      reads.seats += 1;
      return seats;
    },
    async agentTasksThisMonth() {
      reads.tasks += 1;
      return tasks;
    },
  };
}

/** Distinct ids per case: `entitlementsFor` caches one answer per organisation. */
let counter = 0;
const nextOrg = () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;

describe("rooms", () => {
  it("refuses the sixth active room on Free", async () => {
    const store = fakeStore({ rooms: 5 });

    expect(await roomLimit(store, nextOrg())).toEqual({
      limit: "rooms",
      current: 5,
      max: 5,
      plan: "free",
    });
  });

  it("allows a room while the Free ceiling has space", async () => {
    const store = fakeStore({ rooms: 4 });

    expect(await roomLimit(store, nextOrg())).toBeNull();
  });

  it("allows any number on Pro and does not even count", async () => {
    const store = fakeStore({ plan: "pro", rooms: 1000 });

    expect(await roomLimit(store, nextOrg())).toBeNull();
    expect(store.reads.rooms).toBe(0);
  });

  it("limits nothing while billing is off", async () => {
    process.env.REMO_BILLING = "off";
    const store = fakeStore({ plan: "free", rooms: 1000 });

    expect(await roomLimit(store, nextOrg())).toBeNull();
    expect(store.reads.rooms).toBe(0);
  });
});

describe("seats", () => {
  it("refuses one more member when Free has five", async () => {
    const store = fakeStore({ seats: 5 });

    expect(await seatLimit(store, nextOrg())).toEqual({
      limit: "seats",
      current: 5,
      max: 5,
      plan: "free",
    });
  });

  it("allows the fifth member and a request that adds none", async () => {
    const store = fakeStore({ seats: 4 });
    expect(await seatLimit(store, nextOrg())).toBeNull();

    const full = fakeStore({ seats: 5 });
    expect(await seatLimit(full, nextOrg(), { adding: 0 })).toBeNull();
  });

  it("uses the Team ceiling of twenty", async () => {
    const store = fakeStore({ plan: "team", seats: 20 });

    expect(await seatLimit(store, nextOrg())).toEqual({
      limit: "seats",
      current: 20,
      max: 20,
      plan: "team",
    });
  });

  it("limits nothing while billing is off", async () => {
    process.env.REMO_BILLING = "off";
    const store = fakeStore({ seats: 500 });

    expect(await seatLimit(store, nextOrg())).toBeNull();
    expect(store.reads.seats).toBe(0);
  });
});

describe("agent tasks", () => {
  it("refuses the eleventh task of the month on Free", async () => {
    const store = fakeStore({ tasks: 10 });

    expect(await agentTaskLimit(store, nextOrg())).toEqual({
      limit: "agentTasksPerMonth",
      current: 10,
      max: 10,
      plan: "free",
    });
  });

  it("allows the tenth", async () => {
    const store = fakeStore({ tasks: 9 });

    expect(await agentTaskLimit(store, nextOrg())).toBeNull();
  });

  it("is open-ended on Pro and reads no counter", async () => {
    const store = fakeStore({ plan: "pro", tasks: 999 });

    expect(await agentTaskLimit(store, nextOrg())).toBeNull();
    expect(store.reads.tasks).toBe(0);
  });

  it("lets agents.unlimited lift a numeric ceiling without counting", async () => {
    const store = fakeStore({ tasks: 999 });
    const entitlements = {
      plan: "free",
      status: "active",
      limits: { seats: 5, rooms: 5, agentTasksPerMonth: 10, trashDays: 7, storageBytes: null },
      features: new Set(["agents.unlimited"]),
      reason: "plan",
    };

    expect(await agentTaskLimit(store, nextOrg(), { entitlements })).toBeNull();
    expect(store.reads.tasks).toBe(0);
  });

  it("limits nothing while billing is off", async () => {
    process.env.REMO_BILLING = "off";
    const store = fakeStore({ tasks: 999 });

    expect(await agentTaskLimit(store, nextOrg())).toBeNull();
    expect(store.reads.tasks).toBe(0);
  });
});

describe("features", () => {
  it("names the missing feature and the plan on Free", async () => {
    const store = fakeStore();

    expect(await featureLimit(store, nextOrg(), "export.pdf")).toEqual({
      feature: "export.pdf",
      plan: "free",
    });
  });

  it("opens every paid feature on Team", async () => {
    const store = fakeStore({ plan: "team" });

    for (const feature of ["export.pdf", "link.protect", "roles.advanced", "integrations"]) {
      expect(await featureLimit(store, nextOrg(), feature)).toBeNull();
    }
  });

  it("opens everything while billing is off", async () => {
    process.env.REMO_BILLING = "off";
    const store = fakeStore();

    expect(await featureLimit(store, nextOrg(), "export.pdf")).toBeNull();
  });
});

describe("402 responses", () => {
  function fakeResponse() {
    return {
      status: 0,
      headers: null,
      body: null,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(text) {
        this.body = JSON.parse(text);
      },
    };
  }

  it("carries the counters of §2.4", () => {
    const response = fakeResponse();

    planLimitResponse(response, { limit: "rooms", current: 5, max: 5, plan: "free" });

    expect(response.status).toBe(402);
    expect(response.headers).toEqual({ "Content-Type": "application/json" });
    expect(response.body).toEqual({
      error: "PLAN_LIMIT",
      limit: "rooms",
      current: 5,
      max: 5,
      plan: "free",
      message: "the free plan allows 5 active rooms",
    });
  });

  it("carries the feature name", () => {
    const response = fakeResponse();

    planFeatureResponse(response, { feature: "export.pdf", plan: "free" });

    expect(response.status).toBe(402);
    expect(response.body).toEqual({
      error: "PLAN_FEATURE",
      feature: "export.pdf",
      plan: "free",
    });
  });
});
