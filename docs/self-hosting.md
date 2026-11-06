# Self-hosting remo

remo is a Node 22 application, a static web client and PostgreSQL 16. You can run it on a
small VPS with Docker Compose. The repository ships the production pieces; this page
explains how they fit and which values you must supply.

## What you need

- A Linux host with Docker and Docker Compose.
- A domain for the app and, optionally, a second domain for the documentation portal.
- PostgreSQL 16, either in Compose or on a managed host.
- TLS termination. The examples use Caddy; nginx works too.

## Configuration

Copy `deploy/production.env.example` to a private file (mode 600) and replace every
`REPLACE_WITH_…` value:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REMO_DB_PASSWORD` | the same password, for the database tools container |
| `REMO_KEK`, `REMO_KEK_ID` | encrypts provider keys and webhook secrets; back it up |
| `REMO_METRICS_TOKEN` | protects `/metrics` |
| `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN` | public origin of the app; mutations from any other origin are refused |
| `REMO_TRUST_PROXY` | set to `1` behind the shipped proxy, so rate limits key on `X-Forwarded-For` |
| `REMO_LOGIN_LIMIT`, `REMO_LOGIN_IP_LIMIT`, `REMO_REGISTER_LIMIT` | optional rate-limit overrides (defaults: 10 per email+IP, 100 per IP, 20 registrations per IP; the first two per 15 minutes, registration per hour) |
| `REMO_EDGE_NETWORK`, `REMO_DB_NETWORK` | Docker networks shared with the proxy and the database |
| `REMO_DB_HOST` | host used by the `db-tools` container |
| `REMO_DOCS_ORIGIN`, `REMO_METRICS` | optional docs origin and metrics switch |
| `REMO_HASH_CONCURRENCY` | parallel password hashes (default 4) |
| `REMO_WS_RATE_BYTES`, `REMO_WS_BURST_BYTES` | optional write budget per socket (defaults: 256 KiB/s, 16 MiB burst; ADR-173) |
| `REMO_ORG_WS_RATE_BYTES`, `REMO_ORG_WS_BURST_BYTES` | optional write budget shared by an organisation's sockets (defaults: 2 MiB/s, 64 MiB burst) |
| `REMO_ROOM_MAX_BYTES`, `REMO_ROOM_FULL_FRAME_BYTES` | optional room size ceiling and the largest edit a full room still takes (defaults: 64 MiB, 16 KiB) |
| `REMO_ROOM_MAX_OBJECTS` | optional object ceiling for one room (default: 20 000; ADR-176) |

`REMO_KEK` is not stored in PostgreSQL. Losing it makes saved provider keys unreadable.
Keep a copy outside the server.

## First start

```sh
docker compose -f deploy/compose.production.yml build
docker compose -f deploy/compose.production.yml up -d
```

The `web` container serves the app and the guide; `sync` serves the API and websockets.
The guide is built from `guide/` by `pnpm guide:build`; the production image does this
during the build.

Put the reverse proxy in front of `remo-web:8080` (app) and `remo-web:8081` (guide).
`deploy/Caddyfile.snippet` and `deploy/nginx-remo.conf` are starting points.

## Rooms without an owner

Earlier versions let a room exist without an owner, and anyone with the link could edit it.
That mode is closed (ADR-174): such a room answers 403 until it is claimed. Before upgrading,
list what is affected and archive it:

```sh
pnpm db:orphans --list
pnpm db:orphans --archive --yes
```

`--assign <roomId> --user <email>` adopts one room when the owner is actually known. A person
with the link can also claim an archived room from the room screen; claiming clears the
archive flag and assigns the room to their organisation.

## Tenant isolation (RLS)

PostgreSQL row-level security is rolled out in stages (ADR-178). The application connects
as a DML-only role and sets `app.org_id` on its own connection for every request; schema
work and the legacy room repair use the owner. Two URLs make that explicit:

| Variable | Used by |
|---|---|
| `DATABASE_URL` | the sync service (`remo_app`): no table ownership, no `BYPASSRLS` |
| `REMO_MIGRATION_DATABASE_URL` | schema migration, `db:check`, `db:orphans`, `db:rls` (owner) |

Create the role once, then apply the pilot policies:

```sh
REMO_MIGRATION_DATABASE_URL=postgres://owner:... \
REMO_APP_DB_PASSWORD=... \
pnpm db:rls:setup

REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls:enable
pnpm db:rls --check          # owner URL; shows what is still unprotected
```

Every tenant table is protected: the room's content and access tables, organisations and
seats, teams, invitations, integration tokens, agents, audit, AI logs and the event
outbox. `pnpm db:rls --check` is the gate. `users`, `sessions`, `agent_tokens`,
`ai_credentials` and `schema_meta` are global identity/secrets and stay outside tenant
RLS: they are read before an organisation exists, and sign-in cannot depend on a tenant
policy. They keep their own token hashing, rate limits and secret encryption.

If `REMO_MIGRATION_DATABASE_URL` is not set, the service keeps the old single-role
behaviour; do not apply `rls.sql` in that mode. `pnpm db:rls:enable --check` reports the
RLS state without changing anything.

## Security headers

The web container sends the security headers itself (ADR-172): a Content-Security-Policy,
HSTS, `X-Frame-Options`, `nosniff`, a referrer policy and a permissions policy. They live in
`deploy/nginx-security-headers.conf` (app) and `deploy/nginx-security-headers-docs.conf`
(guide), and Caddy passes them through. Do not set the same headers in Caddy as well.

With `deploy/nginx-remo.conf` on the host, the configuration includes the same two files
from `/srv/remo/deploy/`; adjust the path if the tree lives elsewhere.

Things to change for your setup:

- If `VITE_SYNC_URL` points the live socket at another origin, add that origin to
  `connect-src` in the app snippet.
- HSTS is sent for this host only. Add `includeSubDomains` or `preload` only when every
  subdomain of your domain serves HTTPS.

Check a running deployment with `curl -sI https://<your-host>/ | grep -i -E 'content-security|strict-transport'`.

## Releases

`deploy/release.sh` verifies the tree, uploads the exact commit and switches the
containers on the host. Create the local release configuration from the repository root.

```sh
mkdir -p .config/remo
cp -n deploy/deploy.env.example .config/remo/deploy.env
chmod 600 .config/remo/deploy.env
# Edit the SSH destination and both HTTPS origins, then commit the release source.
bash deploy/release.sh
```

The local file is ignored by Git and Docker. Keep database credentials and the KEK
in the server's `/srv/remo/shared/production.env`. The script reads the local file as
data: plain `KEY=VALUE` lines, comments allowed, no shell. It must be owned by you,
mode `600`, and not a symlink. To select another private file, set
`REMO_DEPLOY_ENV_FILE` to its path. If the default file is absent, you can supply the
three variables through the environment, for example in CI.

The script runs the full gate, keeps revisions and images for rollback, and checks
the health endpoints after the switch.

## Backups and upgrades

- Back up PostgreSQL before a schema change; `scripts/db-backup.mjs` writes a
  custom-format dump and a manifest with its size, SHA-256 and row counts. Validate the
  dump with `pg_restore --list` separately if your runbook requires it.
- `pnpm db:restore` restores into an empty database; it is a deliberate operator
  action, not part of a release.
- The schema version is in `apps/sync/schema-version.mjs`. A newer build may require a
  newer schema; a rollback to older code must be checked against it.
- Keep `REMO_KEK` and `production.env` off the server as well.

## Security checklist

- PostgreSQL is not reachable from the internet; bind it to loopback or a private network.
- `NODE_ENV=production` so the session cookie is `Secure`.
- TLS is terminated before the app; the app and sync are not published directly.
- `/metrics` is protected by `REMO_METRICS_TOKEN` or closed by the proxy.
- Outbound provider and webhook requests are HTTPS-only and refuse private addresses by
  default; `REMO_WEBHOOK_ALLOW_PRIVATE=1` is an explicit exception.
- Back up `REMO_KEK` separately from the database.

## Development

See the root `README.md`. The development stack uses `.env.example` and the Compose file
in the repository root; it is not the production configuration.
