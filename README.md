# remo

**A shared visual canvas for teamwork.** Plan projects, draw diagrams and track tasks in
rooms you can host on your own server.

[![CI](https://github.com/jaggalex/remo/actions/workflows/ci.yml/badge.svg)](https://github.com/jaggalex/remo/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

![remo room](docs/screenshots/room.png)

> **Status: 0.2.1 alpha.** The product is usable and self-hosted, but interfaces and
> formats may still change. It is provided **as is**, without warranty — see the
> [disclaimer](https://docs.remo.letii.ru/guide/en/support/disclaimer.html).

## What it is

Use a room to work on a project together. Each room has its own access settings, so
people can have different roles in different rooms.

- **Canvas:** sticky notes, shapes, text, frames, connectors and groups.
- **Cards and kanban:** status, assignee, dates, WIP limits, tags and links.
- **Real-time collaboration:** cursors, presence, follow, shared selection and offline save state.
- **Facilitation:** shared timer, voting on objects, presentation of any object.
- **Discussion:** server-side threads on an object or a point, pins and live reactions.
- **Access:** personal and shared organisations, teams, five room roles, public links with password and expiry. Every account has a unique `@handle`; rooms and objects can carry names.
- **AI agents:** person-owned agents, plans with preview, tidy-up, cards, budgets and an evidential journal.
- **Export and backup:** PNG, PDF and a plain JSON backup that restores the whole room.
- **Extensions:** domain events, signed webhooks, integration tokens and first-party app panels.

The technical model is in [docs/architecture](docs/architecture), the decisions are in
[ADR.md](ADR.md), and the user documentation is in [guide/](guide/).

## Quick start

Requirements: Node 22, pnpm 11, Docker (for PostgreSQL 16).

```sh
pnpm install
cp .env.example .env

pnpm db:up          # PostgreSQL in Docker
pnpm db:check       # connectivity and schema preflight
pnpm sync           # API and websocket rooms on :1234
pnpm dev:web        # product on http://localhost:5173
```

Register an account and land on the organisation home: `?org=<slug>` shows room tiles,
search, sorting and trash, while `?room=<id>` opens a specific room. Every account gets a
personal organisation; shared organisations are additional. Open a room in two browser
windows to see collaboration; `?user=<name>` gives a tab a separate cursor identity for
testing.

## Verify

```sh
pnpm verify           # types, lint, unit and database tests, build, docs, design system
pnpm verify --e2e     # the full gate, including browser acceptance and the guide audit
pnpm lint             # Biome; verify runs it too
pnpm audit:prod       # high/critical production advisories with a fix (separate CI step)
pnpm db:rls --check   # tenant-policy inventory; exits 1 on a gap
pnpm version:show     # version, build, commit, schema
```

Releases are semver plus an automatic build counter; see [CONTRIBUTING.md](CONTRIBUTING.md#versioning-and-releases).

Both verify commands check the dedicated test PostgreSQL from `docker-compose.test.yml`;
start it first with `pnpm test:db:up`. The gate is what CI runs; a change is ready when it
is green. The RLS inventory is not part of the gate: run it after a schema change, with the
owner URL from [self-hosting](docs/self-hosting.md).

## Repository

| Path | What is inside |
|---|---|
| `apps/web` | React + Vite client, Canvas 2D renderer, UI composition |
| `apps/sync` | Node service: API, Yjs rooms, IAM, agents, commands, webhooks |
| `packages/model` | widget types, palette, kanban semantics, templates |
| `packages/doc` | Yjs document, commands, projection, presence |
| `packages/canvas` | camera, hit-testing, connectors, painters |
| `packages/ui` | design tokens and the component library |
| `packages/agent-plan` | plan schema and validation |
| `content/help` | in-app help topics (RU source, EN translation) |
| `guide/` | the public product guide (RU source, EN translation) |
| `deploy/` | Docker Compose, reverse-proxy examples and release scripts |
| `docs/` | self-hosting and architecture notes |
| `spec/` | visual baselines and the template data used by tests |

## Documentation

- [Self-hosting](docs/self-hosting.md) — a VPS, PostgreSQL, TLS, releases and backups.
- [Architecture](docs/architecture) — design system, IAM, agents, MCP, integrations.
- [Product guide](guide/) — the same documentation published at
  [docs.remo.letii.ru](https://docs.remo.letii.ru/guide/ru/overview/index.html).
- [Testing](TESTING.md) — how to run the stack and the acceptance checks.
- [AI entry point](https://docs.remo.letii.ru/guide/llms.txt) — a documentation map for
  LLMs and AI agents; no account or room access is granted.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: an ADR before a behaviour or data-model
change, one mechanism per job, UI strings through i18n (RU + EN), colours and sizes through
design tokens, and `pnpm verify --e2e` before a pull request.

Security issues: please use [SECURITY.md](SECURITY.md), not a public issue.

## Licence

[AGPL-3.0-only](LICENSE). The remo name and logo are a separate brand and are not granted
with the code licence.
