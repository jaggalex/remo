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
| `DATABASE_URL` | service connection as `remo_app`; DML only, no ownership, no `BYPASSRLS` |
| `REMO_MIGRATION_DATABASE_URL` | owner connection for schema work, `db:check`, `db:orphans` and the `db:rls:*` tools |
| `REMO_APP_DB_PASSWORD` | password for `remo_app`; `db:rls:setup` makes the role able to log in |
| `REMO_DB_PASSWORD` | the owner password, for the database tools container |
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

With one URL the service runs as the owner and row-level security cannot contain a missing
predicate. Keep the two roles separate; only `remo_app` serves requests.

## First start

```sh
docker compose -f deploy/compose.production.yml build
docker compose -f deploy/compose.production.yml up -d
```

The `web` container serves the app and the guide; `sync` serves the API and websockets.
The guide is built from `guide/` by `pnpm guide:build`; the production image does this
during the build.

On a fresh database, apply the schema first (`pnpm db:check` with
`REMO_MIGRATION_DATABASE_URL`), then create the `remo_app` role and apply the policies before
`sync` serves traffic; see [Tenant isolation](#tenant-isolation-rls).

Put the reverse proxy in front of `remo-web:8080` (app) and `remo-web:8081` (guide).
`deploy/Caddyfile.snippet` and `deploy/nginx-remo.conf` are starting points.

## Version and build

`GET /api/health` answers with the product identity as well as the probe bit:

```json
{ "ok": true, "version": "0.2.0", "build": "1247", "commit": "a1b2c3d", "schema": 18 }
```

The account menu and the help footer show the same product version and build; `/metrics`
exposes `remo_build_info{version,build,commit,schema} 1`. The deploy passes `REMO_VERSION`,
`REMO_BUILD` and `REMO_COMMIT` as build args and runtime variables, so an image can always
be traced to a commit. `schema` comes from the service code and is not a release number.

## Rooms without an owner

Every room gets an owner when it is created. A row without one is closed (ADR-174): write
routes answer `403 UNCLAIMED`, the access route reports `allowed: false` with reason
`UNCLAIMED`, the socket refuses the upgrade, and the room is not listed in a catalog or a
trash. Before upgrading an older database, list what is affected and archive
it:

```sh
pnpm db:orphans --list
pnpm db:orphans --archive --yes
```

`--assign <roomId> --user <email>` adopts one room when the owner is actually known. It uses
the person's personal organisation, or their earliest active one, and the earliest team in it;
it creates a team when there is none and writes an audit row. A person with the link can also
claim an archived room from the room screen; claiming clears the archive flag and assigns the
room to their organisation. If the room has a claim token, the token is required.

## Tenant isolation (RLS)

Row-level security is complete for schema 18 (ADR-178). The service connects as `remo_app`,
a role with data privileges only: it owns no table and cannot bypass a policy. Every request
that touches tenant data sets `app.org_id` on its own connection and the pool resets it
before reuse; a query without the setting returns zero rows, not every tenant's rows. Schema
work, `db:check`, the room repair and the RLS tools use the owner. The connection settings
make that explicit:

| Variable | Used by |
|---|---|
| `DATABASE_URL` | the sync service as `remo_app`: no table ownership, no `BYPASSRLS` |
| `REMO_MIGRATION_DATABASE_URL` | schema work, `db:check`, `db:orphans`, `db:rls:setup`, `db:rls:enable` (owner) |
| `REMO_APP_DB_PASSWORD` | optional: lets `db:rls:setup` give `remo_app` a login password |

Create the role once per database, then apply the policies:

```sh
REMO_MIGRATION_DATABASE_URL=postgres://owner:... \
REMO_APP_DB_PASSWORD=... \
pnpm db:rls:setup

REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls:enable
REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls --check   # inventory; exits 1 on a gap
REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls:enable --check
```

`db:rls:setup` creates `remo_app` if it is missing, removes `SUPERUSER` and `BYPASSRLS`, and
grants DML on the tables, usage on the sequences and execute on the functions in the public
schema. It never gives ownership. `db:rls:enable` applies `apps/sync/rls.sql`; `--check`
only reports. The owner role must be a superuser or have `BYPASSRLS`: the security-definer
lookups run as that role and return no rows otherwise.

All tenant tables are protected: the room's content and access tables, organisations and
seats, teams, invitations, integration tokens, agents, AI logs and anchors, audit, webhooks
and the event outbox. `pnpm db:rls --check` reports every tenant table protected (exit 0). `pnpm db:rls:enable --check`
covers 37 tables: 32 tenant tables, `orgs`, and four tables that inherit their tenant through
a parent. Neither command is part of `pnpm db:check` or `pnpm verify`; run them after a schema
change and before a release.

`users`, `sessions`, `agent_tokens`, `ai_credentials` and `schema_meta` are global
identity/secrets and stay outside tenant RLS: they are read before an organisation exists,
and sign-in cannot depend on a tenant policy. They keep their own token hashing, rate limits
and secret encryption.

If `REMO_MIGRATION_DATABASE_URL` is not set, the service uses `DATABASE_URL` for everything.
That single-role mode cannot enforce RLS; do not apply `rls.sql` in it.

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
