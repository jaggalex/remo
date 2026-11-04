# apps/sync — what is different here

Additive to [`AGENTS.md`](../../AGENTS.md).
Nothing below repeats a rule that is already written there.

## Shape

- Plain `.mjs`, no build step, no TypeScript. Node 22 in CI and production.
- `server.mjs` is the entry: HTTP + websocket, rooms, and the route modules. Domain logic
  lives in `*-api.mjs` and `pg/*.mjs`; `postgres.mjs` keeps the store lifecycle and mixes the
  `pg/*` methods into the prototype (ADR-053).
- Durable state is Postgres (`DATABASE_URL`); the disk store is a fallback only when no
  database is configured, and the service refuses to start on disk when one is.

## Rules that bite

- **Every mutation goes through a command** with a permission check, and anything that
  changes rights or content writes an `audit` row (ADR-092).
- **A schema change bumps `SCHEMA_VERSION`** in `schema-version.mjs` and lands in
  `schema.sql`; `pnpm db:check` applies the file, so two DDL sources never drift (ADR-089).
- **A new file above 800 lines fails `pnpm size:check`.** `agent-runner.mjs` is at 730.
- **A test that needs the database uses `testDatabaseUrl()`** from `test-db.mjs`, never
  `DATABASE_URL` directly — otherwise it writes into the developer's own database (ADR-131).
- **Board is the unit of authorization.** There are no per-object permissions: a Yjs update
  is never scoped to one object (ADR-061…069).

## Testing here

- Pure pieces (projection, diffing, ids, tokens) keep a `*.test.mjs` beside them and need no
  database.
- Anything touching storage opens it through `testDatabaseStore()`; it verifies the installed
  test-environment identity before constructing the store. A missing test server is an
  intentional local skip, while a connection or migration failure is fatal under `CI`.
  Start the dedicated server with `pnpm test:db:up`; never point it at `DATABASE_URL` (ADR-136).
- `pnpm sync:smoke` starts the service against the configured database and exercises the
  HTTP surface end to end.
