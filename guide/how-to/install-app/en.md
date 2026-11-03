## When you need it

The team needs a button or a short panel on the board, and you do not have to write an extension.

## Before you start

- You are an organisation administrator.
- The board belongs to that organisation: the panel shows the apps of its organisation.

## Steps

1. Install the app:

```bash
curl -X POST https://boards.example.com/api/orgs/$ORG/apps \
  -H "Content-Type: application/json" --cookie "$SESSION" \
  -d '{"appId":"app.hello"}'
```

2. Open the board, then **Ещё ▾** (More) → **Приложения** (Apps).
3. Result: the panel contains the app and its button.

## Checking the action

1. Press **Поздороваться**.
2. Result: the panel shows "Hello, {your name}!".
3. The organisation audit gets `app.invoked`, and the event queue gets an `app.invoked` event.

## Turning it off

1. Turn the app off:

```bash
curl -X PATCH https://boards.example.com/api/orgs/$ORG/apps/app.hello \
  -H "Content-Type: application/json" --cookie "$SESSION" \
  -d '{"enabled":false}'
```

2. Refresh the panel.
3. Result: the app is not in the panel, and its action returns `404`. Turning it back on restores everything.

## Common mistakes

| Symptom | Cause |
|---|---|
| `404 RESOURCE_NOT_AVAILABLE` on install | there is no such id in the product registry |
| `403 FORBIDDEN` | you are not an organisation administrator |
| The panel is empty | the app is off or the board has no organisation |

## Where to go next

[Apps](/guide/capabilities/apps) — what the panel draws and what it does not do.
