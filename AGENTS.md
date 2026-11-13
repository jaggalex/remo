# AGENTS.md — working in this repository

This file is for a human contributor or a coding agent who is about to change remo. Read it
before the first edit; the product rules are not optional style preferences.

## What remo is

A self-hosted, local-first visual canvas for a small team: an organisation home with room
tiles, rooms, frames, sticky notes, cards, kanban, connectors, presentation, comments,
access and AI agents. A room is both the unit of work and the unit of access. Every account
has a personal organisation; shared organisations are additional. `?org=<slug>` is the
organisation home, `?room=<id>` is a room.

- `apps/web` — React + Vite client, Canvas 2D renderer.
- `apps/sync` — Node service: API, Yjs rooms, IAM, commands, agents, webhooks.
- `packages/*` — model, document, canvas, UI, agent plan.
- `content/help` — in-app help (RU source, EN translation).
- `guide/` — the public product guide (RU source, EN translation).
- `spec/` — architecture notes, template data and visual baselines.
- `docs/` — self-hosting and architecture index.

## Rules

1. **One job, one mechanism.** A second way to do the same thing is a defect. If a second
   way is genuinely needed, write an ADR first.
2. **ADR before behaviour or data-model changes.** Add a numbered record to `ADR.md` with
   context, decision and consequences. ADRs are never rewritten; supersede them with a new
   record.
3. **Access is decided on a room.** There are no per-object permissions. HTTP and websocket
   requests use the same access decision.
4. **Every mutation goes through a command** with a permission check. Anything that changes
   rights or content writes an audit row.
5. **UI is Russian and English.** Every user-visible string goes through `apps/web/src/i18n`;
   a key without both translations fails `tsc`.
6. **Design tokens only.** No literal colours or sizes in UI components; use `@remo/ui`.
7. **No secrets in git.** Provider keys and webhook secrets live encrypted in the database;
   the KEK is in the environment. Never commit `.env`, dumps or test artefacts.
8. **A verifiable claim or nothing.** “Looks nice” is not a reason. Measure, test, or cite
   the ADR/guide page that defines the behaviour.

## Commands

| Command | What it proves |
|---|---|
| `pnpm test <file>` | one unit file |
| `pnpm typecheck` | types, docs bundle, tokens |
| `pnpm verify:fast` | the inner gate without the test-database preflight |
| `pnpm verify` | the full gate except browser acceptance |
| `pnpm verify --e2e` | everything CI runs, including Playwright and the guide audit |
| `pnpm e2e` | browser acceptance only |
| `pnpm baselines` | regenerate product visual baselines deliberately |
| `pnpm docs:check` / `pnpm guide:check` | help and portal translation/freshness |
| `pnpm state:write` / `pnpm state:check` | regenerate or check the facts block below |

The test database is separate from development: `pnpm test:db:up`, then
`pnpm test:db:check`. Never point tests at `DATABASE_URL`.

## Change workflow

1. Find the module that owns the behaviour; prefer the existing mechanism.
2. If the behaviour or model changes, write the ADR first.
3. Add or update the test next to the code. A browser-only bug gets an `e2e/` scenario.
4. Update `content/help` for a user-facing workflow and `guide/` when the guide describes it.
5. Run `pnpm verify --e2e` before opening a pull request.
6. Keep the diff focused; do not reformat unrelated files.

## Code rules that bite

- **Model** (`packages/model`): pure functions, invariants in comments, a test beside it.
  A new widget field needs an ADR and a read migration.
- **Sync** (`apps/sync`): plain `.mjs`. Every route that mutates content or rights goes
  through the command layer and writes audit.
- **Web** (`apps/web`): a component is behaviour plus tokens; save and access state come from
  the API, never invented locally.
- **Canvas** (`packages/canvas`): painters take a palette/theme; hit-testing and geometry are
  pure functions and are tested without a browser.
- **UI** (`packages/ui`): `tokens.json` is the source; generated CSS is never edited by hand.
- **Comments** explain why, not what.

## Documentation

- `content/help/<topic>/` — short, screen-linked help. RU is the source; EN is required.
- `guide/<section>/<page>/` — the connected product guide. RU source, EN translation.
- `docs/` — self-hosting and architecture notes.
- `ADR.md` — the decision history.

`pnpm docs:check` and `pnpm guide:check` fail on a stale translation or a broken link.
A page is finished only after a fresh reader has reviewed it against `guide/style.md`.

## Security

The boundary list is in ADR-109. In short: room-scoped access, httpOnly sessions,
encrypted provider keys behind a KEK outside the database, HTTPS-only outbound requests with
private-address refusal, and public links that never grant export or backup. Report a
vulnerability through [SECURITY.md](SECURITY.md), not a public issue.

## Facts

<!-- generated:state:begin -->
_Факты дерева, проверяются `pnpm state:check`; числа прогона печатают сами команды._

| Факт | Значение |
|---|---|
| ADR | 213, последний — ADR-213 |
| Версия схемы | 20 |
| Браузерные сценарии | 159 в 35 файлах |
| Темы помощи | 34 (RU + EN) |
| Страницы портала | 69 |
| Эталоны | 23 продуктовых + 12 DS |
| Крупнейший файл | `apps/web/src/BoardApp.tsx` — 800 строк |
<!-- generated:state:end -->
