/**
 * The test-database rules: a run token that cannot collide by normalisation, a connection
 * contract that never falls back to development, and a skip that is impossible to mistake
 * for a green run when CI requires the database suites.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  databaseUnavailable,
  runToken,
  testDatabaseName,
  testDatabaseStore,
  testDatabaseUrl,
} from "./test-db.mjs";
import { DEFAULT_TEST_POSTGRES_URL } from "../../scripts/test-environment.mjs";
import {
  TestEnvironmentMismatch,
  TestEnvironmentUnavailable,
} from "../../scripts/test-environment.mjs";

const VERIFIED = async () => ({
  name: "remo-test",
  namespace: "remo_test",
  instanceId: "11111111-1111-4111-8111-111111111111",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run tokens", () => {
  it("accepts the command's pid_random token", () => {
    expect(runToken("15472_ab12cd34")).toBe("15472_ab12cd34");
    expect(testDatabaseName("15472_ab12cd34")).toBe("remo_test_15472_ab12cd34");
  });

  it("refuses a token that would have to be rewritten", () => {
    expect(() => runToken("15472-ab12cd34")).toThrow(/must match/);
    expect(() => runToken("15472__ab12cd34")).toThrow(/must match/);
    expect(() => runToken("Run")).toThrow(/must match/);
  });

  it("reserves the control database name", () => {
    expect(() => runToken("control")).toThrow(/reserved/);
  });

  it("keeps two runs apart even when their raw tokens look alike", () => {
    expect(() => testDatabaseName("run-a")).toThrow(/must match/);
    expect(testDatabaseName("run_a")).not.toBe(testDatabaseName("runa"));
  });
});

describe("test connection contract", () => {
  it("derives the run database from the dedicated test server", () => {
    expect(testDatabaseUrl({ REMO_TEST_RUN: "run_a" })).toBe(
      new URL("/remo_test_run_a", DEFAULT_TEST_POSTGRES_URL).toString(),
    );
  });

  it("uses REMO_TEST_POSTGRES_URL and never DATABASE_URL", () => {
    const testUrl = "postgres://test_user:test_pw@127.0.0.1:6000/remo_test_control";
    expect(
      testDatabaseUrl({
        REMO_TEST_RUN: "run_a",
        REMO_TEST_POSTGRES_URL: testUrl,
        DATABASE_URL: "postgres://remo:remo@127.0.0.1:5432/remo",
      }),
    ).toBe(new URL("/remo_test_run_a", testUrl).toString());
  });
});

describe("database unavailability", () => {
  it("is fatal under CI", () => {
    expect(() =>
      databaseUnavailable(
        "cannot reach the test PostgreSQL (ECONNREFUSED);",
        8,
        { CI: "1" },
      ),
    ).toThrow(/ECONNREFUSED.*8 database suites skipped/);
  });

  it("stays a warning locally with an actionable command", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => databaseUnavailable("test server unavailable.", 8, {})).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("8 database suites skipped"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pnpm test:db:up"));
  });
});

describe("suite-level database enforcement", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });

  it("does not open or migrate a store when identity verification fails", async () => {
    const open = vi.fn();
    const mismatch = new TestEnvironmentMismatch("wrong test environment");
    await expect(
      testDatabaseStore("focused suite", {
        url: "postgres://example/test",
        open,
        verify: async () => {
          throw mismatch;
        },
        env: {},
      }),
    ).rejects.toBe(mismatch);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not open a store when the test server is unavailable locally", async () => {
    const open = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      testDatabaseStore("focused suite", {
        url: "postgres://example/test",
        open,
        verify: async () => {
          throw new TestEnvironmentUnavailable("cannot reach the test PostgreSQL");
        },
        env: {},
      }),
    ).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 database suite skipped"));
  });

  it("fails under CI when the suite's own connection fails, even after a good probe", async () => {
    // The global setup probe is deliberately not part of this helper: the suite must fail
    // on its own connection failure, not inherit a false green from an earlier probe.
    await expect(
      testDatabaseStore("focused suite", {
        url: "postgres://example/test",
        verify: VERIFIED,
        open: async () => {
          throw refused;
        },
        env: { CI: "1" },
      }),
    ).rejects.toThrow(/focused suite.*ECONNREFUSED.*1 database suite skipped/);
  });

  it("fails under CI when the suite's migration fails", async () => {
    await expect(
      testDatabaseStore("focused suite", {
        url: "postgres://example/test",
        verify: VERIFIED,
        open: async () => {
          throw new Error('relation "widgets" does not exist');
        },
        env: { CI: "1" },
      }),
    ).rejects.toThrow(/focused suite.*relation "widgets" does not exist/);
  });

  it("fails under CI when no URL is available at suite level", async () => {
    await expect(
      testDatabaseStore("focused suite", { url: null, verify: VERIFIED, env: { CI: "1" } }),
    ).rejects.toThrow(/no test database configured/);
  });

  it("keeps the local skip when no server is available", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      testDatabaseStore("focused suite", { url: null, verify: VERIFIED, env: {} }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 database suite skipped"));
  });

  it("returns the opened store and URL when the suite connects", async () => {
    const store = { connected: true };
    await expect(
      testDatabaseStore("focused suite", {
        url: "postgres://example/test",
        verify: VERIFIED,
        open: async (url) => ({ ...store, url }),
        env: { CI: "1" },
      }),
    ).resolves.toEqual({
      store: { connected: true, url: "postgres://example/test" },
      url: "postgres://example/test",
    });
  });
});
