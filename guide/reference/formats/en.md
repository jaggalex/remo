## Board backup

```json
{
  "manifest": {
    "format": "remo.board.backup",
    "version": 2,
    "boardId": "roadmap-1a2b3c4d",
    "title": "Roadmap",
    "exportedAt": "2026-10-29T12:00:00.000Z",
    "checksum": "sha256:…",
    "counts": { "widgets": 12, "connectors": 3, "assets": 0 },
    "files": ["widgets", "texts", "textDeltas", "kanbans", "meta",
              "groupNames", "tags", "presentation", "comments", "assets"]
  },
  "format": "remo.board",
  "version": 2,
  "board": { "id": "roadmap-1a2b3c4d", "title": "Roadmap" },
  "widgets": {},
  "texts": {},
  "textDeltas": {},
  "kanbans": {},
  "meta": {},
  "groupNames": {},
  "tags": {},
  "presentation": [],
  "comments": [],
  "assets": []
}
```

Version 2 adds group names, the tag vocabulary, presentation order and comments. An object
lock (`locked`, `lockedBy`, `lockedByName`, `lockedAt`) lives inside `widgets` and is restored
with the object: a backup restores the board as it was, it does not make a copy.

Checks on import:

1. `manifest.format` and `manifest.version` match the expected ones.
2. The `checksum` reconciles with the content.
3. Objects match what `counts` promises.

Import **replaces** the board: objects, tags, presentation order and comments come from the
file. An empty comment list clears the discussion. Author names are kept, but the account
link is not, because a backup has no user ids. Version 1 backups still import: missing fields
are treated as empty.

The format is deliberately domain-level: `widgets`, `texts`, `kanbans` are document maps, not
database tables. The internal document state does not get into the file: the import assembles the document anew.

## App manifest

| Field | Value |
|---|---|
| `id` | identifier in the registry, for example `app.hello` |
| `version` | integer, increments on change |
| `nameKey`, `descriptionKey` | interface dictionary keys |
| `capabilities` | what the app needs from the board |
| `panel` | panel schema: `panel`, `text`, `button`, `field` |
| `actions` | button actions and their capabilities |

Strings in the manifest are dictionary keys only, not text: language and wording remain with the product.

## Event envelope

Fields and signature — in the [events reference](/guide/reference/events). In short: `id`, `type`, `orgId`, `boardId`, `actor`, `subject`, `payload`, `occurredAt`; signature `t=<unix>,v1=<hex>` over the string `"<t>.<body>"`.

## Where to go next

[Limits](/guide/reference/limits) — numeric limits that affect these formats.
