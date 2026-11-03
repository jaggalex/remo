/**
 * Metrics sink: a separate PostgreSQL database (ADR-082).
 *
 * It is intentionally not the product database: metrics are not a source of truth for
 * boards, grants or audit, and dropping the metrics database must never affect a board.
 */
export const METRICS_SCHEMA = `
create table if not exists metrics_events (
  event_id uuid primary key,
  name text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  org_id uuid,
  actor_id uuid,
  actor_type text not null,
  board_id text,
  session_id text,
  app_version text not null,
  schema_version integer not null,
  props jsonb not null default '{}'::jsonb
);
create index if not exists metrics_events_time_idx on metrics_events (occurred_at);
create index if not exists metrics_events_org_time_idx on metrics_events (org_id, occurred_at);
create index if not exists metrics_events_name_time_idx on metrics_events (name, occurred_at);
-- Activation is once per workspace, not once per save. A partial unique index makes
-- the event idempotent even when several boards are saved concurrently (ADR-082).
create unique index if not exists metrics_activation_once_idx
  on metrics_events (org_id)
  where name = 'activation.first_value' and org_id is not null;
`;

export class MetricsStore {
  constructor({ connectionString, log = console }) {
    this.connectionString = connectionString;
    this.log = log;
    this.pool = null;
  }

  async connect() {
    const { default: pg } = await import("pg");
    this.pool = new pg.Pool({
      connectionString: this.connectionString,
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    await this.pool.query(METRICS_SCHEMA);
    this.log.log("[metrics] separate database ready");
  }

  /** Best-effort insert. A metrics outage must not affect a board. */
  async record(event) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `insert into metrics_events
          (event_id, name, occurred_at, org_id, actor_id, actor_type, board_id, session_id, app_version, schema_version, props)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict do nothing`,
        [
          event.event_id,
          event.name,
          event.occurred_at,
          event.org_id,
          event.actor_id,
          event.actor_type,
          event.board_id,
          event.session_id,
          event.app_version,
          event.schema_version,
          event.props ?? {},
        ],
      );
    } catch (error) {
      this.log.error?.(`[metrics] write failed: ${error.message ?? error}`);
    }
  }

  async close() {
    await this.pool?.end?.();
    this.pool = null;
  }
}
