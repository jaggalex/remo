## Boundaries

| What | How it is protected |
|---|---|
| Session | httpOnly cookie, `SameSite=Lax`, `Secure` in production |
| Password | hash on the server, constant-time check |
| Provider and webhook secrets | envelope: its own DEK wrapped by the KEK; the KEK is not in the database |
| Integration tokens | SHA-256 only in the database, the secret is shown once |
| Agent tokens | hash, expiry, revocation |
| Public link | no token, read-only, password and expiry optional |
| Metrics | a token in production; the proxy closes `/api/metrics` from outside |
| Read-only socket | type and step are read by a varint decoder; awareness and one `syncStep1` are allowed, update and `syncStep2` are dropped |
| Invitation | the token is a bearer secret; the recipient email is checked before any grant, inside the transaction |
| Room metadata | without access `/access` answers 404 and returns no title, organisation or visibility |
| Outbound AI and webhooks | HTTPS only, every DNS address checked on each delivery, the socket pinned to the verified IP, redirects refused; `ALLOW_PRIVATE` is the explicit exception |
| Comments | account with room access only; a link visitor does not see the discussion |
| A room without an owner | closed for work: actions answer `403` until the room has an owner; the access screen says there is no owner; the link grants no editing |
| Write quotas | the rate and room size are bounded; when exceeded, the connection closes with `4429` or `4413`, and edits stay in the current tab |
| Edit audit | one record per session, room and 60 s window: edit and byte counts, object ids and fields; no content is written |
| Lock | coordination of edits, not an ACL; a raw client with `board.edit` can bypass it |

## Organisation isolation

Every table with organisation data — room content, access, organisations and teams, invitations, integration tokens, agents, audit, the AI journal and the event queue — is protected by row-level isolation (RLS): a row is visible only in the context of its organisation. The service runs as `remo_app`: DML only, no table ownership and no `BYPASSRLS`; schema and maintenance use the owner role, which must be a superuser or have `BYPASSRLS`.

Accounts, sessions, agent tokens, provider keys and schema metadata stay outside organisation isolation: this is the sign-in boundary, and they are read before an organisation is known. They keep their own hashing, expiry and encryption.

## What must not be left at the default

1. **`REMO_KEK`** — 32 bytes base64, kept outside the server and backed up. Losing the KEK makes the stored provider keys unreadable.
2. **`NODE_ENV=production`** — otherwise the cookie is not `Secure`; without HTTPS sign-in will look broken.
3. **`REMO_METRICS_TOKEN`** — otherwise `/metrics` answers 404 (which is better than open metrics).
4. **`REMO_CORS_ORIGIN`** — a specific origin, not `*`, if you use cookies.
5. **Postgres on loopback** — `POSTGRES_PORT=127.0.0.1:5432` and `ufw`.
6. **`REMO_WEBHOOK_ALLOW_PRIVATE`** — only if an internal endpoint is really needed.
7. **Database roles** — the service runs as `remo_app` (DML only, no table ownership and no `BYPASSRLS`), the owner is for schema and maintenance only. Do not run the service as the owner role.

## Public link

The link is a property of the room, not a token: it grants read-only and never grants export or backup. Account menu → **Active sessions** lists the browsers that are signed in and lets you end one without changing the password. Changing the password still closes every open browser. Revoking the link does not revoke personal roles.

## What to check on an installation

- `/api/metrics` answers 404 from outside.
- Ports 1234 and 5432 are not visible from the internet (`ss -ltnp`).
- `.env` is available only to the service user.
- `pnpm db:rls --check` confirms that every table with organisation data is protected.
- `pnpm db:rls:enable --check` confirms the applied set; the owner role is a superuser or has `BYPASSRLS`.
- The `remo_app` role owns no tables and has no `BYPASSRLS`.
- `pnpm db:orphans --list` finds no rooms without an owner; before an upgrade they are archived (`--archive --yes`), and a known owner is assigned with `--assign <room> --user <email>`.
- A room without an owner does not allow work: actions answer `403` until the room gets an owner; the access screen shows the reason.
- A backup of the KEK is kept separately from the database.
- A room without access answers 404 on `/api/boards/<id>/access`, with no title or organisation.
- A crafted varint frame from a viewer does not change the document.
- An invitation opened by another account grants no membership and stays usable by the recipient.
- A custom AI endpoint with `[::ffff:127.0.0.1]` is rejected on save.

## Where to go next

[Observability](/guide/admin/observability) — how to confirm all of this works.
