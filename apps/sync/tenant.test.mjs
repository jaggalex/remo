import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";
import { currentTenant, withTenant } from "./tenant.mjs";

const database = await testDatabaseStore("tenant context");
const store = database?.store ?? null;
const suite = store ? describe : describe.skip;

async function setting() {
  const { rows } = await store.pool.query(
    "select coalesce(current_setting('app.org_id', true), '') as org",
  );
  return rows[0].org;
}

suite("tenant context (ADR-178)", () => {
  it("sets the organisation for the request and clears it afterwards", async () => {
    const org = randomUUID();
    const seen = await withTenant(store.pool, org, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { setting: await setting(), context: currentTenant()?.orgId ?? null };
    });
    expect(seen.setting).toBe(org);
    expect(seen.context).toBe(org);
    expect(currentTenant()).toBeNull();
    // The connection went back to the pool without the setting.
    expect(await setting()).toBe("");
  });

  it("keeps two concurrent requests on their own connections", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const [a, b] = await Promise.all([
      withTenant(store.pool, first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return setting();
      }),
      withTenant(store.pool, second, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return setting();
      }),
    ]);
    expect(a).toBe(first);
    expect(b).toBe(second);
  });

  it("reuses the same tenant and refuses a switch inside one request", async () => {
    const org = randomUUID();
    const other = randomUUID();
    const same = await withTenant(store.pool, org, () =>
      withTenant(store.pool, org, () => setting()),
    );
    expect(same).toBe(org);
    await expect(
      withTenant(store.pool, org, () => withTenant(store.pool, other, () => setting())),
    ).rejects.toThrow(/switched/);
  });

  it("refuses a malformed organisation id before opening a connection", async () => {
    await expect(withTenant(store.pool, "not-a-uuid", () => setting())).rejects.toThrow(
      /invalid organisation id/,
    );
  });

  it("runs a global path without a tenant setting", async () => {
    const value = await withTenant(store.pool, null, () => setting());
    expect(value).toBe("");
  });
});
