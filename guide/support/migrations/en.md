## How migrations work

The service applies the schema itself at start: `schema.sql` is idempotent, the version is stored in `schema_meta`. There is no separate migration command — which means **the backup is taken before the upgrade, not after**. The current version is 18.

Version 17 added `org_id` to the twelve tables tied to a room: existing rows were filled from
their rooms, and a trigger fills it for new rows. Version 18 added functions that run as the
owner to look up an organisation and claim agent tasks and queued events, and brought
row-level isolation for organisations (RLS) to every table that holds tenant data. The
policies themselves are enabled by `db:rls:enable`, not by applying the schema.

:::warning
The schema is applied when the service starts. A backup taken after the upgrade leaves nothing to roll back to.
:::

## Two database roles

Since version 18 the service and maintenance connect differently.

| Role | Variable | What it does |
|---|---|---|
| The application, `remo_app` | `DATABASE_URL` | serves requests: reads and writes data only, owns no table and bypasses no policy |
| The owner | `REMO_MIGRATION_DATABASE_URL` | applies the schema and runs `db:check`, `db:orphans`, `db:rls:setup`, `db:rls:enable`; must be a superuser or have `BYPASSRLS` |

If `REMO_MIGRATION_DATABASE_URL` is not set, the service uses `DATABASE_URL` for everything.
Organisation isolation does not work in that mode, and policies must not be enabled on such an
installation: the application connects as the owner.

The organisation lookup and task claim functions run as the owner. If the owner is neither a
superuser nor has `BYPASSRLS`, they find no rows: sign-in and agent tasks answer with a refusal.

## Upgrade order

```sh
cd /srv/remo
systemctl stop remo-sync
sudo -u remo pnpm db:backup
sudo -u remo git pull
sudo -u remo pnpm install --frozen-lockfile
sudo -u remo pnpm build

# owner: apply the schema before enabling policies
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:check

# rooms without an owner: list first, then decide
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:orphans --list
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:orphans --archive --yes

# application role and policies
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:rls:setup
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:rls:enable
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:rls --check
sudo -u remo env REMO_MIGRATION_DATABASE_URL=postgres://remo:…@127.0.0.1:5432/remo pnpm db:rls:enable --check

systemctl start remo-sync
```

`db:check` applies the schema but does not enable policies: `db:rls:enable` does that.
`db:rls:setup` creates `remo_app` if it is missing, removes `SUPERUSER` and `BYPASSRLS`, and
grants data and function privileges only, with no table ownership. To let the role sign in
with a password, set `REMO_APP_DB_PASSWORD` in the same environment.

1. Stop the service: it will finish writing rooms to the database.
2. Take a backup and make sure the file appears in the list.
3. Update the code and dependencies.
4. Build the static files: an unbuilt frontend gives an old tab on a new API.
5. Apply the schema as the owner: `pnpm db:check`.
6. Find rooms without an owner and archive them or assign an owner.
7. Create the application role and enable the policies.
8. Start the service.

## Rooms without an owner

A room without an owner is closed: the API and the socket refuse, and the room is not in the
room list. Such rooms do not open by themselves after an upgrade, and there is no automatic
deletion: the row stays in the database until it is claimed or assigned an owner.

```sh
pnpm db:orphans --list
pnpm db:orphans --archive --yes
pnpm db:orphans --assign <roomId> --user <email>
```

- `--list` only prints the list and changes nothing.
- `--archive --yes` moves every room without an owner to the archive and writes an audit row.
- `--assign <roomId> --user <email>` assigns an owner when one is known: it uses the person's
  personal organisation, or their earliest active one, and the earliest team in it, and
  creates a team when there is none.

:::warning
`--archive --yes` changes every room without an owner at once. No data is deleted: the room
can be returned by a claim or by assigning an owner.
:::

## Check after start

```sh
curl -s http://127.0.0.1:1234/health
journalctl -u remo-sync -n 50 | grep -i 'schema\|error'
```

- `health` answers `ok`, the schema version in the log matches the expected one.
- `pnpm db:rls --check` reports no gaps, and `pnpm db:rls:enable --check` confirms the applied policy set.
- `pnpm db:orphans --list` finds no rooms without an owner.
- Open a room and make an edit: the indicator must reach **сохранено** (saved).
- Check one sign-in and one link.
- Open the discussion: old threads are still there and a new comment is saved.
- Create a room: it appears in the list and opens for its owner.

## Breaking changes

| What | How to survive it |
|---|---|
| The `remiro` → `remo` rename (2026-10-26) | `REMO_*` variables, the `remo_session` cookie, the `remo` database; all sessions are signed out |
| A cookie name change | there is no migration: the cookie is the mechanism |
| A new mandatory key (for example, `REMO_KEK`) | set it before start, otherwise features answer "locked" |
| Organisation isolation (schema 18) | two roles: `remo_app` in `DATABASE_URL`, the owner in `REMO_MIGRATION_DATABASE_URL`; without `db:rls:setup` and `db:rls:enable` the policies do not work |
| A room without an owner is closed (2026-11-06) | before traffic starts: `pnpm db:orphans --list`, then `--archive --yes` or `--assign <room> --user <email>`; rooms left unhandled stay closed |

## If something went wrong

1. Do not start the old version on top of the new schema.
2. Stop the service and restore the backup.
3. If the database is upgraded and the code is old, roll back the code and restore the database together, not separately.
4. If queries return nothing after the policies are enabled, check that the service connects as `remo_app` and that the owner has `BYPASSRLS`. There is no command that removes the policies: roll back from the backup.

## Where to go next

[Troubleshooting](/guide/support/troubleshooting) — if something does not work after start. [Installation security](/guide/admin/security) — database roles and access boundaries.
