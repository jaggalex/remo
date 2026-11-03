-- remo board storage (ADR-016).
--
-- Two layers: an append-only update log plus a compacted snapshot (the room can
-- always be rebuilt from these), and a queryable projection that is refreshed as
-- a diff while people edit.
--
-- Idempotent: the sync service runs this on every start.

create table if not exists boards (
  id text primary key,
  -- Board name: the document's `meta` title once it has one, otherwise the name the
  -- board was created with. An empty document title never clears it.
  title text not null default '',
  updated_at timestamptz not null default now(),
  -- Full Yjs state as of `snapshot_through`; the log after that point is replayed on load.
  snapshot bytea,
  snapshot_through bigint not null default 0
);

-- Older deployments created `boards` without these columns.
alter table boards add column if not exists title text not null default '';
alter table boards add column if not exists snapshot bytea;
alter table boards add column if not exists snapshot_through bigint not null default 0;

create table if not exists board_updates (
  id bigserial primary key,
  board_id text not null references boards (id) on delete cascade,
  update bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists board_updates_board_id_id_idx on board_updates (board_id, id);

create table if not exists widgets (
  board_id text not null references boards (id) on delete cascade,
  id text not null,
  type text not null,
  parent_id text,
  x double precision,
  y double precision,
  width double precision,
  height double precision,
  title text,
  content text,
  fill_color text,
  card_theme text,
  rotation double precision not null default 0,
  -- Modelled extras the source API does not expose: sticker glyph/caption/reactions,
  -- legend rows. Kept as jsonb so the read path stays complete without a column per
  -- idea (see packages/model/src/decorate.ts).
  props jsonb,
  updated_at timestamptz not null default now(),
  primary key (board_id, id)
);

-- Older deployments created `widgets` without the modelled extras. This must follow
-- the `create table`: on a fresh database the table does not exist yet, and the whole
-- migration used to fail there (found on a new volume at stage 6).
alter table widgets add column if not exists props jsonb;

create index if not exists widgets_board_id_type_idx on widgets (board_id, type);
create index if not exists widgets_parent_idx on widgets (board_id, parent_id);

create table if not exists kanban_columns (
  board_id text not null references boards (id) on delete cascade,
  kanban_id text not null,
  id text not null,
  title text not null default '',
  accent text,
  width double precision,
  wip_limit integer,
  position integer not null default 0,
  primary key (board_id, kanban_id, id)
);

create table if not exists kanban_swimlanes (
  board_id text not null references boards (id) on delete cascade,
  kanban_id text not null,
  id text not null,
  title text not null default '',
  position integer not null default 0,
  primary key (board_id, kanban_id, id)
);

-- Card placement: the part the source product never exposes, so it is worth its own table.
create table if not exists kanban_cards (
  board_id text not null references boards (id) on delete cascade,
  kanban_id text not null,
  card_id text not null,
  column_id text not null,
  swimlane_id text not null,
  order_key text not null default 'n',
  primary key (board_id, kanban_id, card_id)
);

create index if not exists kanban_cards_cell_idx
  on kanban_cards (board_id, kanban_id, column_id, swimlane_id, order_key);

-- Read path: board list and text search over the projection.
--
-- Trigram indexes so `ILIKE '%…%'` can use an index instead of scanning the table.
-- One index per column: the search filters `title` and `content` separately, so a
-- single index over a concatenated expression would never match the query.
create extension if not exists pg_trgm;

create index if not exists widgets_title_trgm_idx on widgets using gin (title gin_trgm_ops);
create index if not exists widgets_props_gin_idx on widgets using gin (props jsonb_path_ops);
create index if not exists widgets_content_trgm_idx on widgets using gin (content gin_trgm_ops);

-- Drop the earlier, unusable expression index if it exists.
drop index if exists widgets_text_trgm_idx;

-- ---------------------------------------------------------------------------
-- IAM v1 (ADR-061…064, spec/IAM-v1.md).
--
-- The board row is the same row the projection uses: a room *is* a board, and the
-- IAM columns are what turn it from "anybody who knows the name" into a resource with
-- an owner. A board with `owner_id IS NULL` is unclaimed and keeps the legacy access
-- rule until somebody claims it (ADR-064).
-- ---------------------------------------------------------------------------

alter table boards add column if not exists org_id uuid;
alter table boards add column if not exists team_id uuid;
alter table boards add column if not exists owner_id uuid;
alter table boards add column if not exists visibility text not null default 'private';
alter table boards add column if not exists acl_version bigint not null default 1;
alter table boards add column if not exists archived_at timestamptz;
alter table boards add column if not exists claimed_at timestamptz;
alter table boards add column if not exists claim_token_hash bytea;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  state text not null default 'active' check (state in ('active', 'suspended')),
  -- Interface preferences that follow the person, not the browser (ADR-150). Null means
  -- "this account has not chosen yet": the first browser to sign in seeds it locally.
  theme text,
  lang text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Older deployments created `users` without the preference columns.
alter table users add column if not exists theme text;
alter table users add column if not exists lang text;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text
);

create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table if not exists org_memberships (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  relation text not null default 'member' check (relation in ('member', 'guest')),
  state text not null default 'active'
    check (state in ('invited', 'active', 'suspended', 'removed')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists admin_roles (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('org_admin', 'user_admin', 'security_admin', 'content_admin')),
  granted_by uuid references users (id),
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id, role)
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists team_memberships (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  source text not null default 'direct' check (source in ('direct', 'group')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id, source)
);

create table if not exists board_grants (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references boards (id) on delete cascade,
  subject_type text not null check (subject_type in ('user', 'team', 'org')),
  subject_id uuid not null,
  role text not null check (role in ('viewer', 'commenter', 'editor', 'coowner')),
  granted_by uuid references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (board_id, subject_type, subject_id)
);

create index if not exists board_grants_board_idx on board_grants (board_id);
create index if not exists board_grants_subject_idx on board_grants (subject_type, subject_id);

create table if not exists board_links (
  board_id text primary key references boards (id) on delete cascade,
  -- Legacy column from the per-copy token model (ADR-069 superseded it). It stays
  -- nullable so existing databases migrate without a destructive rewrite; access is
  -- decided by `boards.visibility` plus the link settings below.
  token_hash bytea unique,
  role text not null default 'viewer' check (role in ('viewer')),
  enabled boolean not null default true,
  version int not null default 1,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

alter table board_links alter column token_hash drop not null;
alter table board_links add column if not exists password_hash text;
alter table board_links add column if not exists password_version int not null default 1;
alter table board_links add column if not exists expires_at timestamptz;

-- A password unlock is a short-lived server-side session, not a client flag: the
-- cookie carries a random token whose hash is checked against the current
-- `password_version`, so changing the password closes every earlier unlock (ADR-069).
create table if not exists board_link_unlocks (
  token_hash bytea primary key,
  board_id text not null references boards (id) on delete cascade,
  password_version int not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists board_link_unlocks_board_idx on board_link_unlocks (board_id);

create table if not exists org_policies (
  org_id uuid primary key references orgs (id) on delete cascade,
  can_share boolean not null default true,
  public_links boolean not null default false,
  invite_members boolean not null default true
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  target_type text not null check (target_type in ('org', 'team', 'board')),
  target_id text,
  email text not null,
  subject_kind text not null default 'member' check (subject_kind in ('member', 'guest')),
  role text not null,
  token_hash bytea not null unique,
  state text not null default 'pending'
    check (state in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid references users (id),
  accepted_by uuid references users (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invitations_email_idx on invitations (email, state);

create table if not exists audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  org_id uuid,
  board_id text,
  action text not null,
  subject text,
  before jsonb,
  after jsonb,
  request_id text,
  reason text,
  -- Which login did it; the account stays in actor_id (ADR-154).
  session_id uuid
);

create index if not exists audit_events_org_idx on audit_events (org_id, at desc);
create index if not exists audit_events_board_idx on audit_events (board_id, at desc);

/* ---------------------------------------------------------------- agents -- */
-- AI agents as principals owned by a person (spec/AI-agents-v1.md). An agent has no
-- seat, no password and no grants of its own: a task is the unit of authority.

alter table org_policies add column if not exists agents_enabled boolean not null default false;
alter table boards add column if not exists agents_enabled boolean not null default false;

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  owner_id uuid not null references users (id) on delete cascade,
  name text not null,
  state text not null default 'active' check (state in ('active', 'disabled')),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create index if not exists agents_org_idx on agents (org_id, state);
create index if not exists agents_owner_idx on agents (owner_id, state);

create table if not exists agent_tokens (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  token_hash bytea not null unique,
  label text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create index if not exists agent_tokens_agent_idx on agent_tokens (agent_id);

create table if not exists agent_skills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs (id) on delete cascade,
  slug text not null,
  version integer not null default 1,
  name text not null,
  description text not null default '',
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  required_capabilities text[] not null default '{}',
  tools text[] not null default '{}',
  risk text not null default 'propose' check (risk in ('read', 'propose', 'write', 'destructive')),
  handler text not null,
  state text not null default 'draft' check (state in ('draft', 'published', 'disabled')),
  created_by uuid references users (id),
  published_by uuid references users (id),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- A global built-in skill and an organisation's own skill live side by side; Postgres
-- treats nulls as distinct, so each needs its own partial unique index.
create unique index if not exists agent_skills_global_idx
  on agent_skills (slug, version) where org_id is null;
create unique index if not exists agent_skills_org_idx
  on agent_skills (org_id, slug, version) where org_id is not null;

create table if not exists agent_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  board_id text not null references boards (id) on delete cascade,
  skill_slug text not null,
  intent text not null,
  input jsonb not null default '{}'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  interval_seconds integer not null check (interval_seconds >= 60),
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create index if not exists agent_schedules_due_idx on agent_schedules (enabled, next_run_at);
create index if not exists agent_schedules_board_idx on agent_schedules (board_id);

create table if not exists agent_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  board_id text not null references boards (id) on delete cascade,
  mode text not null default 'write' check (mode in ('read', 'propose', 'write')),
  capabilities text[] not null default '{}',
  intent text not null,
  input jsonb not null default '{}'::jsonb,
  skill_id uuid references agent_skills (id),
  skill_slug text,
  skill_version integer,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'applied', 'failed', 'cancelled')),
  budget jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid references users (id),
  schedule_id uuid references agent_schedules (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists agent_tasks_board_idx on agent_tasks (board_id, created_at desc);
create index if not exists agent_tasks_agent_idx on agent_tasks (agent_id, created_at desc);
create index if not exists agent_tasks_status_idx on agent_tasks (status, created_at);

create table if not exists agent_actions (
  id bigserial primary key,
  task_id uuid not null references agent_tasks (id) on delete cascade,
  board_id text not null,
  object_id text,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);

create index if not exists agent_actions_task_idx on agent_actions (task_id);

alter table audit_events add column if not exists actor_type text not null default 'user';
alter table audit_events add column if not exists agent_id uuid;
alter table audit_events add column if not exists task_id uuid;
alter table audit_events add column if not exists skill text;
alter table audit_events add column if not exists session_id uuid;

/* ------------------------------------------------ AI credentials and log -- */

alter table org_policies add column if not exists ai_key_mode text not null default 'either'
  check (ai_key_mode in ('either', 'org', 'personal'));
alter table org_policies add column if not exists ai_providers text[] not null default '{}';
alter table org_policies add column if not exists ai_models text[] not null default '{}';

create table if not exists ai_credentials (
  id uuid primary key,
  scope text not null check (scope in ('user', 'org')),
  scope_id uuid not null,
  provider text not null,
  label text not null default '',
  base_url text not null,
  model text,
  -- AES-256-GCM(secret); the DEK is wrapped by a KEK that is not in this database.
  ciphertext bytea not null,
  nonce bytea not null,
  dek_wrapped bytea not null,
  dek_nonce bytea not null,
  kek_id text not null,
  fingerprint text not null,
  is_default boolean not null default true,
  state text not null default 'active' check (state in ('active', 'revoked')),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_used_at timestamptz
);

create index if not exists ai_credentials_scope_idx
  on ai_credentials (scope, scope_id, state);
create unique index if not exists ai_credentials_default_idx
  on ai_credentials (scope, scope_id, provider)
  where is_default and state = 'active';

alter table agents add column if not exists credential_id uuid
  references ai_credentials (id) on delete set null;
alter table agents add column if not exists model text;
alter table agent_tasks add column if not exists credential_id uuid
  references ai_credentials (id) on delete set null;
alter table agent_tasks add column if not exists model text;
alter table agent_tasks add column if not exists progress jsonb not null default '{}'::jsonb;

-- One row per model call: the evidential journal. Append-only, hash-chained per org.
create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  agent_id uuid,
  task_id uuid,
  owner_id uuid,
  board_id text,
  skill text,
  skill_version integer,
  capabilities text[] not null default '{}',
  acl_version bigint,
  provider text,
  model text,
  credential_id uuid,
  key_fingerprint text,
  temperature numeric,
  max_tokens integer,
  toolset text[] not null default '{}',
  prompt_hash text,
  input_object_ids text[] not null default '{}',
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cost_usd numeric(12, 8) not null default 0,
  latency_ms integer,
  status text not null,
  error_code text,
  error_message text,
  request_id text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (org_id, seq)
);

create index if not exists ai_runs_org_idx on ai_runs (org_id, seq desc);
create index if not exists ai_runs_task_idx on ai_runs (task_id);

create table if not exists ai_log_anchors (
  id bigserial primary key,
  org_id uuid not null references orgs (id) on delete cascade,
  seq bigint not null,
  hash text not null,
  destination text not null,
  ref text,
  created_at timestamptz not null default now()
);

create index if not exists ai_log_anchors_org_idx on ai_log_anchors (org_id, seq desc);

alter table agent_tasks add column if not exists idempotency_key text;
create unique index if not exists agent_tasks_idempotency_idx
  on agent_tasks (org_id, idempotency_key)
  where idempotency_key is not null;

/* ---------------------------------------------------------- change sets -- */
-- A change set is a first-class package of deterministic operations. Small work can
-- run atomically; large work runs in chunks with progress and can be resumed after a
-- failure. The task queue executes it, so permissions, budgets and audit stay in one
-- place.

create table if not exists agent_change_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  board_id text not null references boards (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  operations jsonb not null,
  estimate jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','queued','running','applied','failed','cancelled','stale')),
  progress jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  acl_version bigint,
  idempotency_key text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists agent_change_sets_board_idx
  on agent_change_sets (board_id, created_at desc);
create index if not exists agent_change_sets_status_idx
  on agent_change_sets (status, created_at);
create unique index if not exists agent_change_sets_idempotency_idx
  on agent_change_sets (org_id, idempotency_key)
  where idempotency_key is not null;

alter table agent_tasks add column if not exists change_set_id uuid
  references agent_change_sets (id) on delete set null;
create index if not exists agent_tasks_change_set_idx on agent_tasks (change_set_id);

alter table agent_change_sets add column if not exists budget jsonb not null default '{}'::jsonb;
alter table agent_change_sets add column if not exists intent text not null default '';
alter table agent_change_sets add column if not exists origin jsonb not null default '{}'::jsonb;

/* ------------------------------------------------------- authoring plans -- */
-- An agent task that authors a structure ends with a plan, not with objects
-- (ADR-142, M2a). The client applies the plan in one local transaction; the server
-- only stores it, records approval and never writes the board.
--
-- One row per task is the idempotency rule: a task that is run twice refreshes a
-- still-proposed plan, and never overwrites one a person has already approved.

create table if not exists agent_task_plans (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references agent_tasks (id) on delete cascade,
  org_id uuid not null references orgs (id) on delete cascade,
  board_id text not null references boards (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'applied', 'rejected')),
  plan jsonb not null,
  estimate jsonb not null default '{}'::jsonb,
  skill_slug text,
  skill_version integer,
  model text,
  proposed_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references users (id) on delete set null,
  applied_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid references users (id) on delete set null,
  rejection_reason text
);

create index if not exists agent_task_plans_board_idx
  on agent_task_plans (board_id, proposed_at desc);

-- The text a task was given: the task's own wording and one attached file. It is
-- data for the model, not board content, so it is readable through the plan route
-- only (board.edit) and never returned by the task list. The original bytes are not
-- stored: the extracted text is all a model can use, and keeping the upload would
-- only widen the exposure.

create table if not exists agent_task_inputs (
  task_id uuid not null references agent_tasks (id) on delete cascade,
  source text not null check (source in ('text', 'file', 'selection')),
  name text not null default '',
  kind text not null check (kind in ('text', 'md', 'txt', 'csv')),
  content text not null,
  bytes integer not null default 0,
  chars integer not null,
  truncated boolean not null default false,
  truncation_code text,
  created_at timestamptz not null default now(),
  primary key (task_id, source)
);

-- ADR-143: the selection is a task input beside the brief and the file. The inline
-- check covers a fresh database; this pair repairs one created before the value
-- existed, because `create table if not exists` does not change a constraint.
alter table agent_task_inputs drop constraint if exists agent_task_inputs_source_check;
alter table agent_task_inputs add constraint agent_task_inputs_source_check
  check (source in ('text', 'file', 'selection'));

/* ------------------------------------------------------------ facilitation -- */
-- Voting sessions (ADR-074). Votes are rows, not document state: the quota is a
-- database constraint, the tally is an aggregate, and anonymity is a property of the
-- record rather than a rendering decision.

create table if not exists vote_sessions (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references boards (id) on delete cascade,
  org_id uuid,
  created_by uuid,
  -- Name at the time of creation: the facilitator is shown even after a rename.
  created_by_name text not null default '',
  -- Snapshot of the objects that joined the session; later objects do not.
  object_ids jsonb not null,
  votes_per_subject integer not null check (votes_per_subject between 1 and 100),
  anonymous boolean not null default true,
  state text not null default 'open' check (state in ('open', 'ended')),
  ends_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists vote_sessions_board_idx on vote_sessions (board_id, created_at desc);
create index if not exists vote_sessions_open_idx on vote_sessions (board_id) where state = 'open';

create table if not exists votes (
  session_id uuid not null references vote_sessions (id) on delete cascade,
  -- `user:<uuid>` or `visitor:<random>`; the prefix keeps the two kinds apart.
  subject_id text not null,
  object_id text not null,
  weight integer not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  primary key (session_id, subject_id, object_id)
);

create index if not exists votes_session_idx on votes (session_id, object_id);

/* ------------------------------------------------------------- commands -- */
-- One row per executed command, keyed by the caller's idempotency key (ADR-092).
-- A retry returns the recorded result instead of creating a second object.

create table if not exists command_runs (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references boards (id) on delete cascade,
  actor_id text not null,
  actor_type text not null default 'user',
  command text not null,
  idempotency_key text not null,
  result jsonb not null,
  version text not null,
  created_at timestamptz not null default now(),
  unique (board_id, actor_id, idempotency_key)
);

create index if not exists command_runs_board_idx on command_runs (board_id, created_at desc);

/* ---------------------------------------------------------------- events -- */
-- The transactional outbox for domain events (ADR-094). A row exists if and only if
-- the command that produced it was recorded, because both are written in one
-- transaction. Delivery is at-least-once, so a consumer must be idempotent on `id`.

create table if not exists event_outbox (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references boards (id) on delete cascade,
  org_id uuid,
  actor_id text,
  actor_type text not null default 'user',
  type text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  command_run_id uuid,
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  dead_at timestamptz,
  last_error text,
  -- Agent events have no command run: this is their idempotency key (ADR-097).
  dedupe_key text,
  unique (command_run_id, type)
);

-- Columns added with the webhook consumer (ADR-095); guarded so a database created by
-- the previous release gains them too.
alter table event_outbox add column if not exists next_attempt_at timestamptz;
alter table event_outbox add column if not exists dead_at timestamptz;
alter table event_outbox add column if not exists dedupe_key text;

create index if not exists event_outbox_pending_idx
  on event_outbox (occurred_at) where published_at is null;

create index if not exists event_outbox_dead_idx
  on event_outbox (occurred_at) where dead_at is not null;

create unique index if not exists event_outbox_dedupe_idx
  on event_outbox (board_id, dedupe_key) where dedupe_key is not null;

/* -------------------------------------------------------------- webhooks -- */
-- One signed webhook per organisation (ADR-095). The signing secret uses the same
-- envelope as provider keys: its own DEK, wrapped by a KEK that is not in this database.
-- It is returned once, on create or rotate, and never read back.

create table if not exists org_webhooks (
  org_id uuid primary key references orgs (id) on delete cascade,
  url text not null,
  ciphertext bytea not null,
  nonce bytea not null,
  dek_wrapped bytea not null,
  dek_nonce bytea not null,
  kek_id text not null,
  fingerprint text not null,
  enabled boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_delivery_at timestamptz,
  last_error text
);

/* ---------------------------------------------------------- integrations -- */
-- Tokens an integration uses instead of a browser session (ADR-096). The token carries
-- its scopes; the permission that matters is the owner's current access on the board
-- intersected with them. Only the hash is stored, and the secret is shown once.

create table if not exists integration_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  owner_id uuid not null references users (id) on delete cascade,
  label text not null default '',
  token_hash bytea not null unique,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists integration_tokens_org_idx
  on integration_tokens (org_id, created_at desc);

/* ---------------------------------------------------------------- apps -- */
-- First-party apps installed in an organisation (ADR-098). The manifest is copied from
-- the server-side registry at install time; the client only ever names an app id.

create table if not exists org_apps (
  org_id uuid not null references orgs (id) on delete cascade,
  app_id text not null,
  version integer not null default 1,
  manifest jsonb not null,
  state text not null default 'enabled' check (state in ('enabled', 'disabled')),
  installed_by uuid references users (id) on delete set null,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, app_id)
);

/* -------------------------------------------------------------- comments -- */
-- Comments are a server-side social layer (ADR-104/105), not document state: a
-- commenter may write here without receiving write access to the Yjs board. A thread
-- has one anchor (a widget id or a free point); a reply re-opens a resolved thread.

create table if not exists comment_threads (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references boards (id) on delete cascade,
  anchor_kind text not null check (anchor_kind in ('widget','point')),
  widget_id text,
  x double precision,
  y double precision,
  resolved_at timestamptz,
  resolved_by uuid references users (id) on delete set null,
  created_by uuid references users (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comment_threads_board_idx
  on comment_threads (board_id, updated_at desc);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references comment_threads (id) on delete cascade,
  board_id text not null references boards (id) on delete cascade,
  author_id uuid references users (id) on delete set null,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists comments_thread_idx on comments (thread_id, created_at);
create index if not exists comments_board_idx on comments (board_id, created_at);

create table if not exists comment_reads (
  thread_id uuid not null references comment_threads (id) on delete cascade,
  subject_id text not null,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, subject_id)
);

/* ---------------------------------------------------------- schema meta -- */-- The service reads this before applying the file, so a running suite or a second
-- instance does not run DDL on every start (and cannot deadlock with live queries).

create table if not exists schema_meta (
  id integer primary key,
  version integer not null,
  updated_at timestamptz not null default now()
);

insert into schema_meta (id, version) values (1, 13)
on conflict (id) do update set version = excluded.version, updated_at = now();
