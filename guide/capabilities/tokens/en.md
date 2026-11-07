## What it gives

A token lets an integration read a room and run commands without a browser. It does not create new rights: **the effective right is the access of its owner in the room, intersected with the token scope**.

## When to use

- A script or CI has to create objects in a room.
- An external system reads room content on a schedule.
- A webhook receiver wants to confirm a change by reading the room.

## How it works

An organisation administrator issues a token: the secret of the form `remo_it_…` is shown once, only a hash stays in the database. A request with the `Authorization: Bearer remo_it_…` header resolves to the token owner; the server checks the owner's room access, and the scope additionally narrows the set of actions.

| What it does | What is needed |
|---|---|
| `POST /boards/:id/commands` | scope `board.edit` and `board.edit` for the owner |
| `GET /boards/:id/widgets` | scope `board.read` and `board.read` for the owner |

## Example

Input: a token with the `board.read` scope and a room the owner can see. Action: `GET /boards/<id>/widgets` with `Authorization: Bearer …`. Result: `200` and the room objects. The same token on `POST /commands` gets `403 SCOPE_REQUIRED`.

## What you can configure

A label, scopes (`board.read`, `board.edit`) and a lifetime: from 1 to 365 days, 90 by default. There is no token without an expiry.

## Limitations

- A token is no wider than its owner: if the owner loses access to the room, the token loses force on the next request.
- A token cannot read room metadata, export, manage access or invoke agents — those routes are for a session only.
- The idempotency key acts in the token's space: two tokens do not replay each other's command.

## Practical instructions

[Connect an integration](/guide/how-to/connect-integration) — issuing a token and the first command.

## Related capabilities

Events and webhook, access, commands.
