## Event types

| Type | When it occurs | `subject` | `payload` |
|---|---|---|---|
| `board.item.created` | an object was created by a command or an agent | object id | `{ "objectType": "sticky_note" }` |
| `board.connector.created` | a connector was created | connector id | `{ "from": "<id>", "to": "<id>" }` |
| `board.connector.updated` | a connector route or points changed | connector id | `{ "routing": "elbow" }` |
| `app.invoked` | an app action was invoked | app id | `{ "action": "app.hello" }` |

`payload` contains no board content: only identifiers and types.

## Envelope

```json
{
  "id": "9f0c3a4e-6f3a-4e57-9a2f-5d1c0d1c9b11",
  "type": "board.item.created",
  "orgId": "3f2c7d1a-8e4b-4c6a-9f01-2b3c4d5e6f70",
  "boardId": "roadmap-1a2b3c4d",
  "actor": { "id": "5b0e…", "type": "user" },
  "subject": "item_7c1e2f3a9b4d",
  "payload": { "objectType": "sticky_note" },
  "occurredAt": "2026-10-27T12:34:56.789Z"
}
```

`actor.type` is `user`, `agent` or `integration`. For an agent, `actor.id` is the agent id; the person who set the task stays on the task row.

## Headers

| Header | Value |
|---|---|
| `X-Remo-Event` | event `id`: the idempotency key |
| `X-Remo-Event-Type` | event type |
| `X-Remo-Attempt` | attempt number, starting at 1 |
| `X-Remo-Signature` | `t=<unix>,v1=<hex>` |
| `Content-Type` | `application/json` |

The signature is HMAC-SHA256 with the subscription secret over the string `"<t>.<body>"`. The window is 5 minutes. The body is signed before JSON parsing.

## Delivery

- `2xx` — delivered, the event is marked as published.
- any other response, a timeout (5 seconds) or a connection error — retry.
- retry ladder: 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h.
- the eighth failure — `dead_at`, there are no more automatic retries.
- delivery is at-least-once: deduplicate by `X-Remo-Event`.
- redirects are not allowed.

## Administration

| Method and path | What it does |
|---|---|
| `GET /orgs/:id/webhook` | configuration: `url`, `enabled`, `fingerprint`, `lastDeliveryAt`, `lastError` |
| `PUT /orgs/:id/webhook` | create or replace the endpoint; returns the secret once |
| `POST /orgs/:id/webhook/rotate` | a new secret |
| `DELETE /orgs/:id/webhook` | delete the endpoint and the secret |
| `GET /orgs/:id/webhook/deliveries?limit=50&dead=1` | the latest events of the organisation |
| `POST /orgs/:id/webhook/replay` | put back in the queue: `{eventIds?}` or all dead ones |

All routes require an organisation administrator. Mutations and replay write an audit record; reading the endpoint and deliveries does not.

## What has no events

Changes and deletions of existing objects and text edits produce no events — neither for a person nor for an agent.

## Where to go next

[HTTP API](/guide/reference/api) — routes, commands and response codes.
