## How migrations work

The service applies the schema itself at start: `schema.sql` is idempotent, the version is stored in `schema_meta`. There is no separate migration command — which means **the backup is taken before the upgrade, not after**. The current version is 16. Versions 12–16 added account interface preferences, an audit link to the session, idempotency indexes, the mandatory `@handle`, and the organisation model: `orgs.kind`, board emoji, creation date and author.

:::warning
The schema is applied when the service starts. A backup taken after the upgrade leaves nothing to roll back to.
:::

## Upgrade order

```sh
cd /srv/remo
systemctl stop remo-sync
sudo -u remo pnpm db:backup
sudo -u remo git pull
sudo -u remo pnpm install --frozen-lockfile
sudo -u remo pnpm build
systemctl start remo-sync
```

1. Stop the service: it will finish writing rooms to the database.
2. Take a backup and make sure the file appears in the list.
3. Update the code and dependencies.
4. Build the static files: an unbuilt frontend gives an old tab on a new API.
5. Start the service: the schema applies itself.

## Check after start

```sh
curl -s http://127.0.0.1:1234/health
journalctl -u remo-sync -n 50 | grep -i 'schema\|error'
```

- `health` answers `ok`, the schema version in the log matches the expected one.
- Open a board and make an edit: the indicator must reach **сохранено** (saved).
- Check one sign-in and one link.
- Open the discussion: old threads are still there and a new comment is saved.

## Breaking changes

| What | How to survive it |
|---|---|
| The `remiro` → `remo` rename (2026-10-26) | `REMO_*` variables, the `remo_session` cookie, the `remo` database; all sessions are signed out |
| A cookie name change | there is no migration: the cookie is the mechanism |
| A new mandatory key (for example, `REMO_KEK`) | set it before start, otherwise features answer "locked" |

## If something went wrong

1. Do not start the old version on top of the new schema.
2. Stop the service and restore the backup.
3. If the database is upgraded and the code is old, roll back the code and restore the database together, not separately.

## Where to go next

[Troubleshooting](/guide/support/troubleshooting) — if something does not work after start.
