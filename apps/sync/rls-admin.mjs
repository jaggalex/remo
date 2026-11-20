import { readFile } from "node:fs/promises";

export const RLS_TABLES = [
  "boards",
  "widgets",
  "board_grants",
  "board_updates",
  "kanban_cards",
  "kanban_columns",
  "kanban_swimlanes",
  "comments",
  "comment_threads",
  "board_links",
  "board_link_unlocks",
  "command_runs",
  "vote_sessions",
  "agent_actions",
  "orgs",
  "org_memberships",
  "teams",
  "admin_roles",
  "org_policies",
  "org_apps",
  "invitations",
  "integration_tokens",
  "agents",
  "agent_tasks",
  "agent_schedules",
  "agent_change_sets",
  "agent_task_plans",
  "board_agents",
  "agent_threads",
  "agent_thread_messages",
  "ai_runs",
  "ai_log_anchors",
  "audit_events",
  "event_outbox",
  "org_webhooks",
  "agent_skills",
  "team_memberships",
  "comment_reads",
  "votes",
  "agent_task_inputs",
  // Billing rows belong to the organisation and are protected like any other tenant
  // table; the installation-level tables (`prices`, `payment_connections`, …) are not
  // listed here because they carry no `org_id` (ADR-247).
  "billing_accounts",
  "payment_methods",
  "subscriptions",
  "invoices",
  "payments",
  "refunds",
  "org_credit_ledger",
  "billing_events",
  // Uploaded images are a tenant table: every row belongs to exactly one organisation and
  // is read under the same `app.org_id` setting (ADR-249).
  "files",
];

export async function applyRls(client) {
  const sql = await readFile(new URL("./rls.sql", import.meta.url), "utf8");
  await client.query(sql);
  return RLS_TABLES.length;
}

export async function inspectRls(client, appRole = null) {
  const { rows } = await client.query(
    `select c.relname,
            c.relrowsecurity as rls,
            c.relforcerowsecurity as forced,
            exists (select 1 from pg_policies p
                     where p.schemaname = n.nspname and p.tablename = c.relname) as policy,
            case when $2::text is null then true else
              has_table_privilege($2, c.oid, 'SELECT')
              and not pg_has_role($2, c.relowner, 'MEMBER') end as app_access
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1::text[])
      order by c.relname`,
    [RLS_TABLES, appRole],
  );
  const missing = RLS_TABLES.filter((table) => !rows.some((row) => row.relname === table));
  const unprotected = rows.filter((row) => !row.rls || !row.forced || !row.policy);
  const appAccessProblems = rows.filter((row) => !row.app_access);
  return { rows, missing, unprotected, appAccessProblems };
}
