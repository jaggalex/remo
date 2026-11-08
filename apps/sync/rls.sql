-- Row-level security (ADR-178).
--
-- Applied by `pnpm db:rls:enable`, not by the normal schema migration. The application
-- must connect as `remo_app` (created by `db:rls:setup`) and migrations must use the
-- owner: `FORCE` applies to the table owner too, and only a role with `BYPASSRLS` may
-- bypass it. The lookup and claim functions live in `schema.sql`.
--
-- Every tenant table is covered: content, access, organisations, seats, teams,
-- invitations, integration tokens, agents, AI logs, audit and the outbox. `users`,
-- `sessions`, `agent_tokens`, `ai_credentials` and `schema_meta` are global
-- identity/secrets and stay outside tenant RLS.
--
-- A missing setting returns zero rows, never all rows: `nullif(..., '')::uuid` is null
-- and no `org_id` equals null.

-- The lookup and claim functions live in `schema.sql` (schema 18); policies below use
-- them. Keeping them out of this file means a normal migration has them even before RLS
-- is switched on (ADR-178).

-- `orgs` has no `org_id`: the tenant key is its primary key.
alter table orgs enable row level security;
alter table orgs force row level security;
drop policy if exists orgs_tenant on orgs;
create policy orgs_tenant on orgs
  using (id = nullif(current_setting('app.org_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.org_id', true), '')::uuid);

do $$
declare
  t text;
begin
  foreach t in array array[
    'boards', 'widgets', 'board_grants',
    'board_updates', 'kanban_cards', 'kanban_columns', 'kanban_swimlanes',
    'comments', 'comment_threads', 'board_links', 'board_link_unlocks',
    'command_runs', 'vote_sessions', 'agent_actions',
    'org_memberships', 'teams', 'admin_roles', 'org_policies', 'org_apps',
    'invitations', 'integration_tokens',
    'agents', 'agent_tasks', 'agent_schedules', 'agent_change_sets', 'agent_task_plans',
    'board_agents', 'agent_threads', 'agent_thread_messages',
    'ai_runs', 'ai_log_anchors',
    'event_outbox', 'org_webhooks'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format(
      'create policy %I on %I using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t || '_tenant', t
    );
  end loop;
end $$;

-- Tables without their own tenant key inherit it from the row they belong to. The
-- parent table is protected, so the subquery is already constrained by the setting.
alter table team_memberships enable row level security;
alter table team_memberships force row level security;
drop policy if exists team_memberships_tenant on team_memberships;
create policy team_memberships_tenant on team_memberships
  using (exists (
    select 1 from teams p
     where p.id = team_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ))
  with check (exists (
    select 1 from teams p
     where p.id = team_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ));

alter table comment_reads enable row level security;
alter table comment_reads force row level security;
drop policy if exists comment_reads_tenant on comment_reads;
create policy comment_reads_tenant on comment_reads
  using (exists (
    select 1 from comment_threads p
     where p.id = thread_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ))
  with check (exists (
    select 1 from comment_threads p
     where p.id = thread_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ));

alter table votes enable row level security;
alter table votes force row level security;
drop policy if exists votes_tenant on votes;
create policy votes_tenant on votes
  using (exists (
    select 1 from vote_sessions p
     where p.id = session_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ))
  with check (exists (
    select 1 from vote_sessions p
     where p.id = session_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ));

alter table agent_task_inputs enable row level security;
alter table agent_task_inputs force row level security;
drop policy if exists agent_task_inputs_tenant on agent_task_inputs;
create policy agent_task_inputs_tenant on agent_task_inputs
  using (exists (
    select 1 from agent_tasks p
     where p.id = task_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ))
  with check (exists (
    select 1 from agent_tasks p
     where p.id = task_id
       and p.org_id = nullif(current_setting('app.org_id', true), '')::uuid
  ));

-- Skills are either global (built in, `org_id` null) or owned by one organisation.
alter table agent_skills enable row level security;
alter table agent_skills force row level security;
drop policy if exists agent_skills_select on agent_skills;
create policy agent_skills_select on agent_skills
  using (
    org_id is null
    or org_id = nullif(current_setting('app.org_id', true), '')::uuid
  );
drop policy if exists agent_skills_write on agent_skills;
create policy agent_skills_write on agent_skills
  with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Audit is append-only and contains pre-login rows with no organisation. A tenant sees
-- its own rows; an insert with a foreign org is rejected, while the global pre-login row
-- stays possible.
alter table audit_events enable row level security;
alter table audit_events force row level security;
drop policy if exists audit_events_select on audit_events;
create policy audit_events_select on audit_events
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
drop policy if exists audit_events_insert on audit_events;
create policy audit_events_insert on audit_events
  with check (
    org_id is null
    or org_id = nullif(current_setting('app.org_id', true), '')::uuid
  );

-- The owner or an operator can confirm the pilot from psql:
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class where relname in (
--       'board_updates','kanban_cards','kanban_columns','kanban_swimlanes',
--       'comments','comment_threads','board_links','board_link_unlocks');
