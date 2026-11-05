## Authentication

| Who | With what | Where it is accepted |
|---|---|---|
| Person | session cookie | all product routes |
| Integration | `Authorization: Bearer remo_it_…` | commands and room reads |
| Agent | `Authorization: Bearer` agent token | only `/agent/**` routes |

An integration token is not accepted on agent routes, and an agent token is not accepted on human ones.

## Room

The prose says “room”. Paths, commands and capabilities keep the historical name `board`: they are technical identifiers, not a second product noun.

| Method and path | What it does |
|---|---|
| `GET /boards?org=<slug>&q=&sort=&dir=&page=&trash=` | the home: room tiles, search, sorting and pages |
| `GET /boards/:id` | room metadata and your role |
| `PATCH /boards/:id/icon` | the tile emoji: `{icon}`; an empty string clears it |
| `DELETE /boards/:id` | move the room to the trash |
| `POST /boards/:id/restore` | restore a room from the trash (owner) |
| `POST /boards/:id/duplicate` | copy a room (owner or co-owner) |
| `GET /boards/:id/access` | the access decision for the current viewer |
| `GET /boards/:id/widgets` | room objects (a token needs `board.read`) |
| `POST /boards/:id/commands` | run a command (a token needs `board.edit`) |
| `GET /boards/:id/link` | public link state |
| `PUT /boards/:id/link` | enable or disable the link, set a password and an expiry |
| `GET /boards/:id/people` | room people for assignee; no email, account required |
| `GET /boards/:id/grants` | access list with names |
| `POST/DELETE /boards/:id/grants` | grant or revoke a role; co-owner requires `board.manage` |
| `GET /boards/:id/comments` | threads, messages and unread counts |
| `POST /boards/:id/comments` | create a thread anchored to a `widget` or `point` |
| `POST /boards/:id/comments/:threadId/replies` | reply; reopens a resolved thread |
| `PATCH /boards/:id/comments/:threadId` | `{resolved: true|false}` |
| `POST /boards/:id/comments/:threadId/read` | mark the thread read |
| `POST /boards/:id/comments/restore` | replace threads from a backup; requires `board.backup` |
| `PATCH/DELETE /boards/:id/comment-messages/:id` | edit/delete your own; delete also needs `board.manage` |

## Commands

`POST /boards/:id/commands` accepts `{command, input, ifVersion?}` and requires the
`Idempotency-Key` header. Response: `{result, version, replayed?}`.

| Command | `input` |
|---|---|
| `board.item.create` | `{type: "sticky_note"\|"text"\|"shape"\|"frame", x, y, width?, height?, content?, name?, style?}` |
| `board.item.update` | `{id, patch: {x?, y?, width?, height?, title?, content?, name?, style?, locked?}}` |
| `board.item.delete` | `{id}` |
| `board.text.set` | `{id, text}` |
| `board.connector.create` | `{from, to, routing?, arrow?, waypoints?, style?, id?}` |
| `board.connector.update` | `{id, routing?, waypoints?}` |

`name` is an optional label of up to 120 characters; an empty string clears it and uniqueness is not checked. All six commands require the `board.edit` capability. `ifVersion` is compared with the current document
version: a mismatch gives `409 STALE`. Updating or deleting a locked object is refused with
`OBJECT_LOCKED`; only the author or a `board.manage` holder may send `locked: false`, and a
foreign attempt gets `LOCKED_BY_OTHER`.

## Export

| Method and path | What it does |
|---|---|
| `POST /boards/:id/export-jobs` | `{scope, format, objectCount}` → `{jobId}` |
| `POST /boards/:id/export-jobs/:jobId/complete` | mark completion and record the size |
| `GET /boards/:id/backup` | full JSON backup with a checksum |

`scope` is `selection`, `frame` or `board`; the job `format` is `png` or `pdf`. A backup is a separate `GET /boards/:id/backup`, not a job format.

## Organisation

| Method and path | What it does |
|---|---|
| `GET /orgs/:id/apps` | installed apps with panels |
| `POST /orgs/:id/apps` | install by `{appId}` |
| `PATCH /orgs/:id/apps/:appId` | `{enabled}` — turn off or on |
| `DELETE /orgs/:id/apps/:appId` | remove |
| `POST /orgs/:id/apps/:appId/invoke` | `{boardId, action}` — run the action |
| `GET /orgs/:id/integration-tokens` | list of tokens without secrets |
| `POST /orgs/:id/integration-tokens` | `{label, scopes, expiresInDays}` → the secret once |
| `DELETE /orgs/:id/integration-tokens/:tokenId` | revoke |

The webhook is in the [event reference](/guide/reference/events).

## Example

:::tabs
:::tab Request
```bash
curl -X POST https://boards.example.com/api/boards/$BOARD/commands \
  -H "Authorization: Bearer remo_it_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: note-1" \
  -d '{"command":"board.item.create","input":{"type":"sticky_note","x":0,"y":0}}'
```
:::
:::tab Response
```json
{
  "result": { "id": "item_7c1e2f3a9b4d", "type": "sticky_note" },
  "version": "9f0c3a4e6f3a4e57",
  "replayed": false
}
```
:::
:::

## Where to go next

[Error codes](/guide/reference/errors) — what a refusal means and which action clears it.
