/**
 * The naming and ownership rules the harness relies on before it drops a database.
 *
 * Regression tests for the failures a review found: a name alone was treated as ownership,
 * a pid was treated as a live run, and two differently-spelled tokens could collapse onto
 * one database name.
 */
import { describe, expect, it } from "vitest";
import {
  E2E_DB_PREFIX,
  TEST_DB_PREFIX,
  e2eDatabaseName,
  isE2eDatabaseName,
  isManagedDatabaseName,
  isOwnedBy,
  isRunOwnedE2eDatabase,
  isTestDatabaseName,
  isValidRunToken,
  ownershipMarker,
  testDatabaseName,
} from "./db-identifiers.mjs";

const ENV = {
  name: "remo-test",
  namespace: "remo_test",
  instanceId: "11111111-1111-4111-8111-111111111111",
};

describe("test database names", () => {
  it("accepts only remo_test_<exact token>", () => {
    expect(isTestDatabaseName("remo_test_1234_ab12cd34")).toBe(true);
    expect(isTestDatabaseName("remo_test_local")).toBe(true);
    expect(isTestDatabaseName(TEST_DB_PREFIX)).toBe(false);
    expect(isTestDatabaseName("remo_test_")).toBe(false);
    expect(isTestDatabaseName("remo_test_control")).toBe(false);
    expect(isTestDatabaseName("remo_e2e_1000_ab12cd34")).toBe(false);
    expect(isTestDatabaseName("remo_test_a-b")).toBe(false);
    expect(isTestDatabaseName("remo_test_a__b")).toBe(false);
    expect(isTestDatabaseName("remo_test_A")).toBe(false);
  });

  it("does not let two different tokens collapse onto one name", () => {
    expect(testDatabaseName("run_one")).not.toBe(testDatabaseName("runone"));
    expect(() => testDatabaseName("run-two")).toThrow(/must match/);
    expect(() => testDatabaseName("run__two")).toThrow(/must match/);
    expect(() => testDatabaseName("Run_Two")).toThrow(/must match/);
    expect(() => testDatabaseName("x".repeat(41))).toThrow(/must match/);
  });

  it("rejects a token outside the identifier alphabet", () => {
    expect(isValidRunToken("ok_1")).toBe(true);
    expect(isValidRunToken("1_2_3")).toBe(true);
    expect(isValidRunToken("")).toBe(false);
    expect(isValidRunToken("a b")).toBe(false);
    expect(isValidRunToken("a_")).toBe(false);
  });
});

describe("e2e database names", () => {
  it("includes the run token so two runs never share a database", () => {
    expect(e2eDatabaseName("", "pid_ab12cd34")).toBe(`${E2E_DB_PREFIX}_pid_ab12cd34`);
    expect(e2eDatabaseName("1000", "pid_ab12cd34")).toBe(
      `${E2E_DB_PREFIX}_1000_pid_ab12cd34`,
    );
    expect(e2eDatabaseName("", "pid_ab12cd34")).not.toBe(
      e2eDatabaseName("", "pid_ef567890"),
    );
    // Both test lifecycles live in the one `remo_test_` namespace.
    expect(isTestDatabaseName(e2eDatabaseName("", "pid_ab12cd34"))).toBe(true);
  });

  it("refuses a missing or malformed run token", () => {
    expect(() => e2eDatabaseName("", "")).toThrow(/run token/);
    expect(() => e2eDatabaseName("", "pid-1")).toThrow(/run token/);
    expect(() => e2eDatabaseName("1000-a", "pid_1")).toThrow(/suffix/);
  });

  it("refuses a name PostgreSQL would truncate", () => {
    const suffix = "s".repeat(40);
    const run = "r".repeat(40);
    expect(() => e2eDatabaseName(suffix, run)).toThrow(/identifier limit/);
    expect(e2eDatabaseName("1000", "pid_1").length).toBeLessThanOrEqual(63);
  });

  it("refuses a suffix that would need normalising", () => {
    expect(() => e2eDatabaseName("1000 a", "pid_1")).toThrow(/suffix/);
    expect(() => e2eDatabaseName("1000__a", "pid_1")).toThrow(/suffix/);
    expect(isE2eDatabaseName("other_1000")).toBe(false);
  });

  it("treats another run's valid name as another run's", () => {
    expect(isE2eDatabaseName("remo_test_e2e_1000_pid_1")).toBe(true);
    expect(isRunOwnedE2eDatabase("remo_test_e2e_1000_pid_1", "remo_test_e2e_1000_pid_1")).toBe(
      true,
    );
    // Both are valid gate names; only one belongs to this run.
    expect(isRunOwnedE2eDatabase("remo_test_e2e_1000_pid_1", "remo_test_e2e_2000_pid_2")).toBe(
      false,
    );
    expect(isRunOwnedE2eDatabase("remo_test_e2e_1000_pid_1", "not_a_gate_name")).toBe(false);
  });

  it("recognises only the managed test namespace", () => {
    expect(isManagedDatabaseName("remo_test_pid_1")).toBe(true);
    expect(isManagedDatabaseName("remo_test_e2e_1000_pid_1")).toBe(true);
    expect(isManagedDatabaseName("remo")).toBe(false);
    expect(isManagedDatabaseName("postgres")).toBe(false);
    expect(isManagedDatabaseName("remo_e2e")).toBe(false);
  });
});

describe("database ownership", () => {
  it("binds the marker to the environment instance and the run", () => {
    expect(isOwnedBy(ownershipMarker(ENV, "run_a"), ENV, "run_a")).toBe(true);
    expect(isOwnedBy(ownershipMarker(ENV, "run_a"), ENV, "run_b")).toBe(false);
    expect(
      isOwnedBy(ownershipMarker(ENV, "run_a"), { ...ENV, instanceId: "22222222-2222-4222-8222-222222222222" }, "run_a"),
    ).toBe(false);
  });

  it("only accepts this run's marker", () => {
    // No marker: a database from before markers, or one made by hand. Unknown ownership.
    expect(isOwnedBy(null, ENV, "run_a")).toBe(false);
    expect(isOwnedBy(undefined, ENV, "run_a")).toBe(false);
    expect(isOwnedBy("", ENV, "run_a")).toBe(false);
    expect(isOwnedBy("remo-owner:", ENV, "run_a")).toBe(false);
  });
});
