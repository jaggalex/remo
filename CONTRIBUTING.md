# Contributing to remo

Thanks for taking the time. This repository values small, deliberate changes over large
surprises.

## Before you start

- Read [ADR.md](ADR.md) for the decisions that shape the product.
- For a behaviour or data-model change, add an ADR first. Code without an ADR is a draft.
- For a bug, open an issue with the reproduction and the expected result.
- For a security issue, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Setup

Requirements: Node 22, pnpm 11, Docker.

```sh
pnpm install
cp .env.example .env
pnpm db:up
pnpm sync
pnpm dev:web
```

## The gate

```sh
pnpm verify --e2e   # includes pnpm lint
pnpm audit:prod     # separate CI step, not part of verify
```

`pnpm verify` checks the dedicated test database (start it first with `pnpm test:db:up`),
typecheck, lint, unit and database tests, the build, documentation and the guide, and the
design-system checks. `--e2e` adds browser acceptance and the guide audit. A pull request is
ready only when it is green. Run `pnpm verify:fast` in the inner loop.

`pnpm lint` runs Biome with the hook-placement rule as an error; `pnpm lint:strict` also
fails on warnings. `pnpm audit:prod` fails on a high or critical production advisory only
when a fix exists; CI runs it as its own step.

## Tenant isolation

Production connects as `remo_app`, a DML-only role with no table ownership and no
`BYPASSRLS`; each tenant request sets `app.org_id`, and a query without it returns zero
rows. A change to a tenant table must keep that true.

```sh
pnpm db:rls:setup            # create the role once (owner URL)
pnpm db:rls:enable           # apply apps/sync/rls.sql (owner URL)
pnpm db:rls --check          # exit 1 on any tenant table without FORCE RLS
pnpm db:rls:enable --check   # the 37 protected tables
```

Run these with `REMO_MIGRATION_DATABASE_URL`; the owner must be a superuser or have
`BYPASSRLS`, or the security-definer lookups return no rows. The RLS suite creates its own
database on the test server (`pnpm test:db:up`) because `FORCE` takes an exclusive lock. The
inventory is not part of `pnpm verify`: run it after a schema change.

## Rules that reviewers enforce

- **One job, one mechanism.** A second way to do the same thing is a defect. Propose an
  ADR if the second way is genuinely needed.
- **Access is decided on a room.** A role is granted on a room; there are no per-object
  permissions.
- **UI in Russian and English.** Every user-visible string goes through `i18n.tsx`; a key
  without both languages fails `tsc`.
- **Tokens only.** No literal colours or sizes in UI components; use `@remo/ui` tokens.
- **Mutations go through commands.** The sync service checks permission and writes audit.
- **Tests stay close to the code.** A model change gets a unit test next to it; a browser
  scenario belongs in `e2e/` when the bug can only be seen in a browser.
- **Documentation is part of the change.** Update `content/help` for a user-facing change
  and `guide/` when a workflow changes. `pnpm docs:check` and `pnpm guide:check` must pass.

## Pull requests

- Keep the diff focused; explain the problem and the decision, not only the code.
- Use the pull-request template and fill in the verification you ran.
- New dependencies need a reason; prefer the standard library and existing packages.
- Do not commit secrets, database dumps, `.env` files or generated test artefacts.

## Licence

By contributing you agree that your contribution is licensed under
[AGPL-3.0-only](LICENSE).
