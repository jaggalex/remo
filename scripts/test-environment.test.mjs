/**
 * The test-environment contract (ADR-136).
 *
 * These tests prove the isolation properties that matter most: the connection contract is
 * independent of DATABASE_URL, the identity must be installed and match, and bootstrap
 * refuses a server that already holds another database (the development one).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_POSTGRES_URL,
  TestEnvironmentMismatch,
  TestEnvironmentNotBootstrapped,
  TestEnvironmentUnavailable,
  bootstrapTestEnvironment,
  controlUrlOf,
  databaseUrlFor,
  identityFromRow,
  readTestEnvironment,
  serverUrlOf,
  testPostgresUrl,
  verifyTestEnvironment,
} from "./test-environment.mjs";

const IDENTITY_ROW = {
  environment: "remo-test",
  namespace: "remo_test",
  instance_id: "11111111-1111-4111-8111-111111111111",
};

function clientWith(handler) {
  return {
    ended: false,
    async query(sql, params) {
      return handler(sql, params);
    },
    async end() {
      this.ended = true;
    },
  };
}

describe("test connection contract", () => {
  it("defaults to the dedicated loopback test server", () => {
    expect(testPostgresUrl({})).toBe(DEFAULT_TEST_POSTGRES_URL);
    expect(new URL(DEFAULT_TEST_POSTGRES_URL).hostname).toBe("127.0.0.1");
    expect(new URL(DEFAULT_TEST_POSTGRES_URL).port).toBe("55432");
    expect(new URL(DEFAULT_TEST_POSTGRES_URL).username).toBe("remo_test");
  });

  it("uses REMO_TEST_POSTGRES_URL and ignores DATABASE_URL", () => {
    const override = "postgres://someone:secret@127.0.0.1:6000/control";
    expect(
      testPostgresUrl({
        REMO_TEST_POSTGRES_URL: override,
        DATABASE_URL: "postgres://remo:remo@127.0.0.1:5432/remo",
      }),
    ).toBe(new URL(override).toString());
  });

  it("rejects a non-postgres URL", () => {
    expect(() => testPostgresUrl({ REMO_TEST_POSTGRES_URL: "mysql://host/db" })).toThrow(
      /postgres/,
    );
  });

  it("derives server, control and run URLs on the same host", () => {
    const url = "postgres://u:p@127.0.0.1:6000/anything";
    expect(new URL(serverUrlOf(url)).pathname).toBe("/postgres");
    expect(controlUrlOf(url)).toBe(new URL("/remo_test_control", url).toString());
    expect(databaseUrlFor(url, "remo_test_run")).toBe(
      new URL("/remo_test_run", url).toString(),
    );
  });
});

describe("installed identity", () => {
  it("accepts only the expected name, namespace and a valid instance id", () => {
    expect(identityFromRow(IDENTITY_ROW)).toEqual({
      name: "remo-test",
      namespace: "remo_test",
      instanceId: IDENTITY_ROW.instance_id,
    });
    expect(() => identityFromRow(null)).toThrow(/empty/);
    expect(() => identityFromRow({ ...IDENTITY_ROW, environment: "development" })).toThrow(
      /environment/,
    );
    expect(() => identityFromRow({ ...IDENTITY_ROW, namespace: "public" })).toThrow(
      /namespace/,
    );
    expect(() => identityFromRow({ ...IDENTITY_ROW, instance_id: "not-a-uuid" })).toThrow(
      /instance id/,
    );
  });

  it("reports an un-bootstrapped server separately from a mismatch", async () => {
    const client = clientWith(() => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    await expect(readTestEnvironment(client)).rejects.toBeInstanceOf(
      TestEnvironmentNotBootstrapped,
    );
  });

  it("verifies through a control connection", async () => {
    const client = clientWith((sql) => {
      if (sql.startsWith("select environment")) return { rows: [IDENTITY_ROW] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const identity = await verifyTestEnvironment("postgres://u:p@127.0.0.1:6000/x", {
      connect: async (url) => {
        expect(new URL(url).pathname).toBe("/remo_test_control");
        return client;
      },
    });
    expect(identity.name).toBe("remo-test");
    expect(client.ended).toBe(true);
  });

  it("turns an unreachable server into an actionable unavailable error", async () => {
    await expect(
      verifyTestEnvironment("postgres://u:p@127.0.0.1:1/x", {
        connect: async () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        },
      }),
    ).rejects.toThrow(/pnpm test:db:up/);
    await expect(
      verifyTestEnvironment("postgres://u:p@127.0.0.1:1/x", {
        connect: async () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        },
      }),
    ).rejects.toBeInstanceOf(TestEnvironmentUnavailable);
  });
});

describe("bootstrap safety", () => {
  it("refuses a server that already contains another database", async () => {
    const admin = clientWith((sql) => {
      if (sql === "select pg_advisory_lock(hashtext($1))") return { rows: [] };
      if (sql === "select pg_advisory_unlock(hashtext($1))") return { rows: [] };
      if (sql.includes("from pg_database")) return { rows: [{ datname: "remo" }] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    let connects = 0;
    await expect(
      bootstrapTestEnvironment("postgres://u:p@127.0.0.1:6000/control", {
        connect: async () => {
          connects += 1;
          return admin;
        },
      }),
    ).rejects.toBeInstanceOf(TestEnvironmentMismatch);
    expect(connects).toBe(1);
    expect(admin.ended).toBe(true);
  });
});
