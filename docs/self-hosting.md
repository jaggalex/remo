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
| `REMO_EDGE_NETWORK`, `REMO_DB_NETWORK` | Docker networks shared with the proxy and the database |

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
  custom-format dump and checks it with `pg_restore --list`.
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
