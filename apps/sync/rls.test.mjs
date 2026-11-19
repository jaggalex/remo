import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { hashToken } from "./iam.mjs";
import { PostgresStore } from "./postgres.mjs";
import { testDatabaseStore } from "./test-db.mjs";
import { testPostgresUrl } from "../../scripts/test-environment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * This suite applies DDL to enable RLS. Run it on its own database: `ALTER TABLE ...
 * FORCE` takes an ACCESS EXCLUSIVE lock and would deadlock with the suites that share
 * the normal test database (the runner is parallel).
 */
async function openDatabase() {
  const controlUrl = testPostgresUrl();
  const name = `remo_test_rls_${process.pid}_${Date.now()}`;
  const { default: pg } = await import("pg");
  const control = new pg.Client({ connectionString: controlUrl, connectionTimeoutMillis: 5000 });
  try {
    await control.connect();
    await control.query(`create database ${name}`);
  } catch {
    await control.end().catch(() => {});
    return { database: null, controlUrl, name: null };
  }
  await control.end().catch(() => {});
  const url = new URL(controlUrl);
  url.pathname = `/${name}`;
  const database = await testDatabaseStore("row-level security", { url: url.toString() });
  return { database, controlUrl, name };
}

const { database, controlUrl, name } = await openDatabase();
const store = database?.store ?? null;
const suite = store ? describe : describe.skip;

afterAll(async () => {
  await store?.close().catch(() => {});
  if (!name) return;
  const { default: pg } = await import("pg");
  const control = new pg.Client({ connectionString: controlUrl, connectionTimeoutMillis: 5000 });
  try {
    await control.connect();
    await control.query(`drop database if exists ${name}`);
  } catch {
    /* the test server is gone; the next run starts clean */
  } finally {
    await control.end().catch(() => {});
  }
});

let policySetup = null;

/** DDL takes an ACCESS EXCLUSIVE lock; apply it once per suite, not once per test. */
function setupPolicies() {
  policySetup ??= installPolicies();
  return policySetup;
}

async function installPolicies() {
  // The test cluster is a superuser; the app role is deliberately not one. One client
  // holds the lock_timeout and the whole policy batch, so a parallel suite cannot leave
  // half the DDL committed.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const client = await store.pool.connect();
    try {
      await client.query("set lock_timeout = '10s'");
      await client.query(
        `do $$
         begin
           if not exists (select 1 from pg_roles where rolname = 'remo_app') then
             create role remo_app nologin;
           end if;
           if not exists (
             select 1 from pg_auth_members m
               join pg_roles r on r.oid = m.roleid
               join pg_roles u on u.oid = m.member
              where r.rolname = 'remo_app' and u.rolname = current_user
           ) then
             execute format('grant remo_app to %I', current_user);
           end if;
         end $$`,
      );
      await client.query("alter role remo_app nobypassrls nosuperuser");
      await client.query("grant usage on schema public to remo_app");
      await client.query(
        "grant select, insert, update, delete on all tables in schema public to remo_app",
      );
      await client.query("grant usage, select on all sequences in schema public to remo_app");
      await client.query("grant execute on all functions in schema public to remo_app");
      await client.query(readFileSync(join(HERE, "rls.sql"), "utf8"));
      return;
    } catch (error) {
      if (attempt === 3 || !/lock timeout|deadlock detected/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally {
      client.release();
    }
  }
}

async function seed() {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `rls-a-${orgA}`;
  const slugB = `rls-b-${orgB}`;
  const boardA = `rls-a-${Date.now()}`;
  const boardB = `rls-b-${Date.now()}`;
  const { rows: users } = await store.pool.query(
    "insert into users (email, password_hash, name, handle) values ($1, 'x', 'RLS', $2) returning id",
    [`rls-${orgA}@example.com`, `rls-${orgA}`],
  );
  const userId = users[0].id;
  await store.pool.query(
    "insert into orgs (id, name, slug) values ($1, $2, $3), ($4, $5, $6)",
    [orgA, "RLS A", slugA, orgB, "RLS B", slugB],
  );
  await store.pool.query(
    "insert into org_memberships (org_id, user_id, relation, state) values ($1, $2, 'member', 'active'), ($3, $2, 'member', 'active')",
    [orgA, userId, orgB],
  );
  await store.pool.query(
    "insert into boards (id, title, org_id, owner_id) values ($1, $2, $3, $5), ($4, $6, $7, $5)",
    [boardA, "A", orgA, boardB, userId, "B", orgB],
  );
  // The trigger fills org_id; the test writes no org_id on purpose.
  await store.pool.query(
    "insert into board_updates (board_id, update) values ($1, $2), ($3, $4)",
    [boardA, Buffer.from([0]), boardB, Buffer.from([0])],
  );
  await store.pool.query(
    `insert into widgets (board_id, id, type, x, y, width, height)
     values ($1, 'w1', 'sticky_note', 0, 0, 100, 100),
            ($2, 'w1', 'sticky_note', 0, 0, 100, 100)`,
    [boardA, boardB],
  );
  await store.pool.query(
    `insert into board_grants (board_id, subject_type, subject_id, role)
     values ($1, 'user', $2, 'viewer')`,
    [boardA, randomUUID()],
  );
  return { orgA, orgB, boardA, boardB, userId, slugA, slugB };
}

suite("row-level security (ADR-178 stage 2)", () => {
  it("shows one tenant its rows and refuses a write for another", async () => {
    await setupPolicies();
    const { orgA, orgB, boardA, boardB, userId, slugA } = await seed();

    const client = await store.pool.connect();
    try {
      await client.query("set role remo_app");
      await client.query("select set_config('app.org_id', $1, false)", [orgA]);

      const { rows } = await client.query("select board_id from board_updates order by board_id");
      expect(rows.map((row) => row.board_id)).toEqual([boardA]);

      await expect(
        client.query("insert into board_updates (board_id, update) values ($1, $2)", [
          boardB,
          Buffer.from([0]),
        ]),
      ).rejects.toThrow(/row-level security/);

      // Switching the setting is the only way to see the other tenant.
      await client.query("select set_config('app.org_id', $1, false)", [orgB]);
      const other = await client.query("select board_id from board_updates order by board_id");
      expect(other.rows.map((row) => row.board_id)).toEqual([boardB]);
    } finally {
      await client.query("reset role").catch(() => {});
      client.release();
    }
  });

  it("returns zero rows when no tenant is set", async () => {
    await setupPolicies();
    const client = await store.pool.connect();
    try {
      await client.query("set role remo_app");
      await client.query("reset app.org_id");
      const { rows } = await client.query("select board_id from board_updates");
      expect(rows).toEqual([]);
    } finally {
      await client.query("reset role").catch(() => {});
      client.release();
    }
  });

  it("runs the service as remo_app while migrations use the owner", async () => {
    await setupPolicies();
    await store.pool.query("alter role remo_app login password 'rls-test'");
    const appUrl = new URL(database.url);
    appUrl.username = "remo_app";
    appUrl.password = "rls-test";

    const { orgA, orgB, boardA, boardB, userId, slugA } = await seed();
    await store.pool.query(
      `insert into kanban_columns (board_id, kanban_id, id, title, position)
       values ($1, 'k1', 'c1', 'One', 0), ($2, 'k1', 'c1', 'One', 0)`,
      [boardA, boardB],
    );

    const appStore = new PostgresStore({
      connectionString: appUrl.toString(),
      migrationConnectionString: database.url,
      log: { log() {}, error() {} },
    });
    try {
      await appStore.connect();
      const mine = await appStore.withTenant(orgA, () => appStore.getBoard(boardA));
      expect(mine?.kanban.columns.map((column) => column.id)).toEqual(["c1"]);

      // The board row itself is not in the pilot yet; its protected children are.
      // `boards` is protected now, so another tenant's board is not even a row.
      const foreign = await appStore.withTenant(orgA, () => appStore.getBoard(boardB));
      expect(foreign).toBeNull();

      // The bootstrap lookup still resolves a board without a tenant context.
      const lookup = await appStore.boardLookup(boardB);
      expect(lookup).toEqual({ org_id: orgB, owner_id: userId });

      // The organisation home: one query, one organisation, RLS on boards/widgets.
      const page = await appStore.withTenant(orgA, () =>
        appStore.listBoardDirectory(userId, { orgSlug: slugA }),
      );
      expect(page.boards.map((board) => board.id)).toEqual([boardA]);

      // Registration creates the org and its seats before a request context exists.
      const created = await appStore.createOrgWithOwner({
        name: "RLS new",
        slug: `rls-new-${Date.now()}`,
        userId,
        kind: "personal",
      });
      expect(created.org.id).toBeTruthy();
      const orgs = await appStore.listOrgsForUser(userId);
      expect(orgs.map((org) => org.id)).toContain(created.org.id);
      const bySlug = await appStore.getOrgBySlug(created.org.slug);
      expect(bySlug?.id).toBe(created.org.id);

      // Invitation acceptance looks the token up before the org is known, then writes
      // under that organisation.
      const inviteEmail = `invite-${orgA}@example.com`;
      const { rows: invitees } = await store.pool.query(
        `insert into users (email, password_hash, name, handle)
         values ($1, 'x', 'Invitee', $2) returning id`,
        [inviteEmail, `invitee-${orgA}`],
      );
      const invitee = invitees[0].id;
      const inviteToken = `invite-secret-${orgA}`;
      await store.pool.query(
        `insert into invitations
           (org_id, target_type, target_id, email, subject_kind, role, token_hash, expires_at)
         values ($1, 'org', $2, $3, 'member', 'editor', $4, now() + interval '1 day')`,
        [orgA, orgA, inviteEmail, hashToken(inviteToken)],
      );
      const accepted = await appStore.acceptInvitation({
        tokenHash: hashToken(inviteToken),
        userId: invitee,
        email: inviteEmail,
      });
      expect(accepted).not.toBeNull();
      expect((await appStore.listOrgsForUser(invitee)).map((org) => org.id)).toContain(orgA);

      // An integration token is found by bearer hash without a tenant, then touched
      // inside its organisation.
      const integrationSecret = `integration-secret-${orgA}`;
      await appStore.withTenant(orgA, () =>
        appStore.createIntegrationToken({
          orgId: orgA,
          ownerId: userId,
          label: "Test",
          scopes: ["board.read"],
          expiresAt: new Date(Date.now() + 60_000),
          tokenHash: hashToken(integrationSecret),
        }),
      );
      const integration = await appStore.findIntegrationToken(hashToken(integrationSecret));
      expect(integration.org_id).toBe(orgA);
      await appStore.withTenant(orgA, () => appStore.touchIntegrationToken(integration.id));

      // The scheduler reads a task's organisation before claiming it.
      const { rows: agents } = await store.pool.query(
        `insert into agents (org_id, owner_id, name, state)
         values ($1, $2, 'Runner', 'active') returning id`,
        [orgA, userId],
      );
      const { rows: tasks } = await store.pool.query(
        `insert into agent_tasks (org_id, agent_id, board_id, intent)
         values ($1, $2, $3, 'rls test') returning id`,
        [orgA, agents[0].id, boardA],
      );
      expect(await appStore.agentTaskOrg(tasks[0].id)).toBe(orgA);
      expect((await appStore.nextAgentTask()).id).toBe(tasks[0].id);
      expect(
        (await appStore.withTenant(orgA, () => appStore.claimAgentTask(tasks[0].id)))?.id,
      ).toBe(tasks[0].id);

      // Audit: own org passes, a foreign org is rejected, the pre-login null still works.
      await appStore.withTenant(orgA, () =>
        appStore.recordAudit({ orgId: orgA, boardId: boardA, action: "rls.test" }),
      );
      await expect(
        appStore.withTenant(orgA, () =>
          appStore.recordAudit({ orgId: orgB, boardId: boardB, action: "rls.test" }),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        appStore.recordAudit({ orgId: null, action: "rls.pre-login" }),
      ).resolves.toBeUndefined();

      // The outbox claim marks rows across organisations and finalizes inside each one.
      await appStore.withTenant(orgA, () =>
        appStore.recordEvents({
          boardId: boardA,
          orgId: orgA,
          actorType: "agent",
          events: [{ type: "rls.test", subject: "event", payload: {} }],
        }),
      );
      const drained = await appStore.drainEvents({ handle: async () => {}, limit: 10 });
      expect(drained.seen).toBeGreaterThanOrEqual(1);
    } finally {
      await appStore.close().catch(() => {});
    }
  });
});
