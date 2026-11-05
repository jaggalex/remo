## How to read

The schema version is the number in the `schema_meta` table. The service applies `schema.sql`
at start and does not touch the database if the version is already current. Product changes
ship together with a schema version; there is no separate "documentation release".

## Schema versions

| Version | What it added |
|---|---|
| 4 | the event queue `event_outbox` |
| 5 | the organisation webhook `org_webhooks` and retry fields on events |
| 6 | integration tokens `integration_tokens` |
| 7 | the event deduplication key `dedupe_key` |
| 8 | organisation apps `org_apps` |
| 9 | comments: `comment_threads`, `comments`, `comment_reads` |
| 10 | an agent plan: `agent_task_plans`, statuses `proposed`/`approved`/`applied`/`rejected` |
| 11 | task input: `agent_task_inputs` with the `selection` source |
| 12 | account interface preferences: `users.theme`, `users.lang` |
| 13 | audit linked to the session: `audit_events.session_id` |
| 14 | idempotency indexes for commands and tasks |
| 15 | the mandatory unique `@handle`: `users.handle` |
| 16 | personal organisations and the home: `orgs.kind`, `boards.icon`, `boards.created_at`, `boards.created_by` |

Versions 1–3 are the early line: rooms, access and the command journal. Databases created
earlier are upgraded by the same `schema.sql` at start.

## What changed in the product and documentation

| Date | What |
|---|---|
| 04.11.2026 | Templates arrive in the profile language: Russian names, copy and kanban columns for a Russian account. The plus in an empty kanban cell creates a card and opens its editor immediately. |
| 04.11.2026 | The product says “room”: one noun in the interface and documentation; the technical `board.*` names remain identifiers. |
| 04.11.2026 | Every account has a personal organisation; the home shows room tiles with name search, sorting, 24-per-page, trash and emoji; switching organisation leaves the room. |
| 04.11.2026 | Presentation accepts any object, not only a frame; an object has a name, a read-only ID and **Copy ID**; search reads the name. |
| 04.11.2026 | A unique `@handle` beside the name: the account menu, presence and comments show `Name @handle`. |
| 04.11.2026 | An organisation and a team can be renamed, a team deleted and its members managed; the account display name is editable. |
| 03.11.2026 | Security and reliability pass: CSRF/Origin, sign-in limits, comment permissions, backup, webhooks, idempotency and crash recovery. |
| 02.11.2026 | An agent proposes a plan from text, a file or a selection: a preview with a map and warnings, Apply in one transaction, one ⌘Z; a plan above 300 objects is refused before it is stored. |
| 02.11.2026 | Tidy up lays a selection out by Auto, By prefix, By type, Grid and By meaning; blocks are frames, up to 50 objects, one ⌘Z. |
| 02.11.2026 | One palette for the rail and the object window: seven tones at three levels, with white, black and transparent in a separate column and keys 1–7. |
| 02.11.2026 | A new room screen: a header with menus, a creation rail, a bottom zoom bar; a frame and a shape resize with the corner handles. |
| 02.11.2026 | A connector joins a selection and an export only with both ends; an object has four ports, and a port click joins or creates a copy. |
| 02.11.2026 | An open voting session names who voted for what after it ends; the published result is ordinary text without markup. |
| 29.10.2026 | Voting happens on the room: a "+1"/"−1" counter on every object, a bar with the remaining votes and the clock; a session ends with the timer or its own deadline and closes by itself. |
| 29.10.2026 | "Delete?" and "replace?" questions belong to the app: no browser windows remain, and the link is shown in a normal field when the clipboard is refused. |
| 29.10.2026 | Security pass: the read-only socket decodes varints, co-owner requires `board.manage`, the invitation email is checked in the transaction, network boundaries answer 400/500, AI outbound checks every address and refuses redirects, `/access` returns no metadata. |
| 29.10.2026 | Current-slide comments in presentation; PNG/PDF with pins and a thread list |
| 29.10.2026 | A card can be a connector endpoint; the line follows its cell |
| 29.10.2026 | A card filter by assignee and due state selects cards without hiding the room |
| 29.10.2026 | A frame adopts an object whose centre lands inside and releases it on exit; one transaction with the move |
| 29.10.2026 | Documentation brought up to M0–M5: roles with `board.comment`, backup v2, new error codes, capability map, security and changelog |
| 28.10.2026 | M5: author lock, `Unlock all`, copies without a lock |
| 28.10.2026 | M4: server comments, pins, reactions, live frame, restore from backup |
| 28.10.2026 | M3: frame presentation, presenter/followers, late viewer |
| 28.10.2026 | M2: tag vocabulary, selection by tag, external and internal links |
| 28.10.2026 | M1: card status, assignee, date range, WIP |
| 28.10.2026 | M0: room creation, sticky focus, group name, object link |
| 28.10.2026 | Product Guide portal: RU/EN, `pnpm guide:check` in `pnpm verify` |
| 27.10.2026 | Integration tokens, webhook, events, apps — documentation for extensions |

## Where to look for behaviour, not a version

The schema version answers "what is in the database". What that means for a user is in
[Capability map](/guide/overview/map) and [Product model](/guide/concepts/board).

## Where to go next

[Upgrades and migrations](/guide/support/migrations) — how to move to a new version.
