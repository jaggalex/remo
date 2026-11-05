## What to back up

| What | Why |
|---|---|
| Room database (`pg_dump`) | rooms, access, journal, events, tokens |
| `REMO_KEK` | without it provider keys and webhook secrets cannot be decrypted |
| `.env` | the settings without which the installation will not come up |
| Anchor directory (`REMO_AI_ANCHOR_DIR`) | the heads of the journal hash chain |

The metrics database is separate; losing it does not affect rooms, but there will be nothing to restore the product event history from.

## Steps: a backup

```sh
cd /srv/remo
sudo -u remo pnpm db:backup
sudo -u remo pnpm db:backup:list
```

The script uses `pg_dump` or the compose container, keeps the last 14 dumps (`REMO_BACKUP_KEEP`) and puts them in `backups/`.

## Steps: restore

```sh
systemctl stop remo-sync
sudo -u remo pnpm db:restore backups/<file> --yes
systemctl start remo-sync
```

Restore is destructive: without `--yes` it does nothing, it saves a safety copy before replacing, and it refuses to overwrite a database containing rooms without `--force`.

## Check

- `pnpm db:backup:list` shows today's file.
- Once a month, restore a copy on a test installation and open a room: **a backup that has never been restored is a hope, not a reserve**.
- Check that the KEK from the backup decrypts a secret: add a provider key on the test copy.

## Separately: a room backup

A room export (**Экспорт → Бэкап комнаты**, export → room backup) is not an installation backup: it contains one room and no access, journal or keys. It is for a person; `pg_dump` is for the administrator.

A version 2 room backup includes objects, text, kanban, group names, tags, presentation order and comments; an object lock is restored with the object. Import replaces the whole room, including the discussion: an empty comment list clears the threads. Author names are kept, the account link is not.

## Where to go next

[Upgrades and migrations](/guide/support/migrations) — what to do when the version changes.
