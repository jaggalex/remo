## When you need it

An external system must read the room, change it and receive events about changes.

## Before you start

- You are an organisation administrator: only an administrator can issue a token and configure a webhook.
- Your account has edit permission in the room the integration will work with.
- The endpoint is reachable over HTTPS, even on the internal network. `REMO_WEBHOOK_ALLOW_PRIVATE=1` allows an internal address but does not waive HTTPS.

## Steps: a token

1. Issue a token:

```bash
curl -X POST https://boards.example.com/api/orgs/$ORG/integration-tokens \
  -H "Content-Type: application/json" --cookie "$SESSION" \
  -d '{"label":"ci","scopes":["board.read","board.edit"],"expiresInDays":90}'
```

2. Copy `secret` from the response: it is shown once.
3. Result: `201` and a `token` object with `scopes`, `expiresAt`, `id`.

## Steps: the first command

1. Create a sticky note:

```bash
curl -X POST https://boards.example.com/api/boards/$BOARD/commands \
  -H "Authorization: Bearer remo_it_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: first-note-1" \
  -d '{"command":"board.item.create","input":{"type":"sticky_note","x":0,"y":0}}'
```

2. Repeat the request with the same `Idempotency-Key`. Result: no second object is created, and the response contains `replayed: true`.
3. Result of the first request: `200`, with the object `id` in `result`.

## Steps: a webhook

1. Configure the endpoint:

```bash
curl -X PUT https://boards.example.com/api/orgs/$ORG/webhook \
  -H "Content-Type: application/json" --cookie "$SESSION" \
  -d '{"url":"https://example.com/hooks/remo"}'
```

2. Copy `secret` (`whsec_…`): it is shown once.
3. Result: `201`, with `webhook.enabled: true` in the response.

## Checking the signature

Verify the signature over the **raw body** of the request, before parsing JSON:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (!parts.v1 || !/^[0-9a-f]+$/i.test(parts.v1) || parts.v1.length % 2) return false;
  const timestamp = Number(parts.t);
  const given = Buffer.from(parts.v1, "hex");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"),
    "hex",
  );
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## Check

- The event reaches the endpoint within a few seconds after the command.
- The signature matches the body you received.
- A repeated command with the same key does not create a second object.

## Common mistakes

| Symptom | Cause |
|---|---|
| `401 INTEGRATION_TOKEN_EXPIRED` | the token has expired — issue a new one |
| `403 SCOPE_REQUIRED` | the token has no required scope |
| `404 RESOURCE_NOT_AVAILABLE` | the token owner cannot see the room |
| The event did not arrive | the endpoint is not configured or does not answer `2xx` |

## Where to go next

[Event reference](/guide/reference/events) — envelope, types and retries.
