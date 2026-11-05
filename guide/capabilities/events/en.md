## What it gives

An organisation configures one HTTPS endpoint and receives events about what happened on its rooms: an object was created, a connector was created or changed, an app action was invoked. The event arrives signed, so the receiver can prove that the request comes from us.

## When to use

- Keep an external system up to date with room changes.
- Start automation on a fact, not on a schedule.
- Collect an activity log of agents and people.

## How it works

An event is created when a command runs and enters a queue. The service takes the queue once a second and sends an HTTP POST to the organisation endpoint. Success is a `2xx` response. Any other response, a timeout or a connection error leads to a retry ladder: 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h. After the eighth failure the event goes to the dead-letter queue (**DLQ**) and is no longer sent automatically.

Delivery is **at-least-once**: one event can arrive twice. Deduplicate by the event `id`.

## Example

Input: a room, a configured webhook, the `board.item.create` command. Action: the integration creates a sticky note. Result: a POST arrives at the endpoint; a fragment of the body is `{"type":"board.item.created","subject":"item_…","payload":{"objectType":"sticky_note"}}`, the header is `X-Remo-Signature`.

## What you can configure

The endpoint URL, enabling and disabling, secret rotation, resending undelivered events. The format and the types are fixed.

## Limitations

- One endpoint per organisation: delivery goes to it, not to "several subscribers".
- The event has no room content: only identifiers, types and counters. Text is read through the API.
- If no endpoint is configured, events are created but marked as sent without a request.
- Object changes, deletions and text edits produce no events — neither from a person nor from an agent.

## Practical instructions

[Connect an integration](/guide/how-to/connect-integration) — from a token to the first delivered event.

## Related capabilities

Integration tokens, apps, agents.
