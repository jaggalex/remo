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
pnpm verify --e2e
```

This runs the dedicated test database, typecheck, unit and database tests, browser
acceptance, documentation and guide checks, the build and the design-system checks. A pull
request is ready only when it is green. Run `pnpm verify:fast` in the inner loop.

## Rules that reviewers enforce

- **One job, one mechanism.** A second way to do the same thing is a defect. Propose an
  ADR if the second way is genuinely needed.
- **Access is decided on a board.** A role is granted on a board; there are no per-object
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
