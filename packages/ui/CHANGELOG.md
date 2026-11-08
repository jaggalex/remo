# Changelog — @remo/ui

Semver. A breaking token change (rename, removal, a role pointing elsewhere) is a major
version with a note here and a codemod where possible.

## 1.0.0 — 2026-10-26

First package release (replaces the single-file prototype bundle).

- **Tokens:** one source `src/tokens/tokens.json`, generated into `primitive.css`,
  `semantic.css`, `component.css`, `themes/light.css`, `themes/dark.css`. Every
  literal (hex, rgba, shadow) lives in a primitive; semantic tokens are aliases only.
  Dark theme declares only roles — no duplicated primitives.
- **Fixed:** `selection-fill` back to 8 % (was 10 %). Empty radio groups no longer
  render as checked (`:indeterminate` matched radios).
- **Connector** follows ADR-077: `routing` (straight | elbow | curved) × `head`
  (none | arrow | block) covers ТЗ §5.1's four types; no detached/`invalid` state;
  selected connectors show hollow end/rigid points and filled segment midpoints.
- **Strings:** components ask for `UiKey`s through `<UiStringsProvider>`; the words
  live in `apps/web/src/i18n.tsx` under `ds.*` (no second i18n mechanism).
- **Font:** Inter self-hosted (latin + cyrillic variable woff2, OFL); no Google Fonts.
- **Checks:** `ds:tokens --check`, `ds:contrast`, stylelint, vitest (tokens, literal
  scan, component render).
- **Canvas:** `readCanvasTokens()` for Canvas 2D painters; DOM canvas components are
  the visual contract and catalogue examples (ADR-078).

## 1.1.0 — 2026-10-26

Catalogue and guidelines close acceptance item 1.

- **Catalogue:** the nine-state matrix now covers `Menu`, `Tabs`, `Table`, `Dialog`,
  `ConfirmDialog`, `AccessRow`, `Textarea` and `Link`; components whose states are
  product states declare them in a visible table instead of pretending to have nine.
- **Catalogue-only props:** `force` on `Textarea`, `Link` and `Tabs`, `rowForce` on
  `Table` — the same pattern as `Button`/`Input`/`Checkbox`; they do not affect the app.
- **Guidelines:** every exported component has one; added `List`, `Skeleton`,
  `Separator`, `ReadOnlyBadge`, `LockBadge`, `FollowIndicator`, `Ports`, `ZoomControls`,
  `AvatarStack`, `Textarea`, `Radio`, `Switch`, and a `## Состояния` section everywhere.

## 1.2.0 — 2026-10-26

Canvas palette and agent status tokens; the product now consumes the package.

- **Tokens:** `agent-soft` / `text-agent` (violet) for the agent badge; `violet-50`
  and `alpha-violet-18` primitives. Contrast now checks 154 pairs.
- **Canvas:** `readCanvasTokens()` covers every colour the painters need (surfaces,
  borders, text, accent, states, selection, presence ink); `@remo/canvas` takes the
  result as `CanvasPalette` and no longer hard-codes chrome colours.
- **Product:** `apps/web` imports `@remo/ui/styles.css` before its own stylesheet,
  legacy `--ink…` names are aliases, `styles.css` has no colour literals, and a test
  fails if one returns. Inter is the default font for notes and chrome.
- **Presence:** the six document presence colours match `presence-1…6`.

## 2.0.0 — 2026-11-07

Visual language v3 «Следы и Поля» (ADR-181) and paper sticker tones (ADR-182). Major:
several roles point elsewhere, and the six saturated `*-100` sticker primitives are removed.

- **Tokens** (`docs/design/DESIGN.md`, migrated once from the previous set;
  `src/tokens/tokens.json` stays the only source from now on):
  - ink `#1E2136` is `neutral-900`; the dark half of the neutral ramp is blue-black,
    the light half warm paper; `bg-canvas` / `bg-app` are `#fbfbfa`;
  - `accent` is ink (the primary button is an ink pill); focus and links stay blue;
  - the agent has no colour: `agent`, `text-agent` are ink, `agent-hatch` is paper,
    `agent-proposal` is the dashed hull (3.46:1 to the canvas); the violet agent
    primitives are gone;
  - new roles `border-panel`; new primitives `radius-xl` 24, `radius-2xl` 28, the
    paper tones `paper-<tone>-100|300` (ADR-182), which replace `yellow-100`, `orange-100`,
    `pink-100`, `violet-100`, `blue-100` and `green-100` (only stickers used them); new components `panel-border-width`, `control-large`;
    `radius-xs` 2, `panel-tasks-height` 124 (`topbar-height` 52 and `toolbar-width` 48 stay: ADR-119 and the canvas layout tests);
  - `shadow-pop` and `shadow-bar` are `none` (panels are outlined); the sticker shadow
    sits under the bottom edge only;
  - `sticker-*` are the paper 100 row of ADR-182.
- **Font:** Golos Text (latin + cyrillic variable woff2, OFL) is `font-sans`, and the
  board paints note, shape, card and kanban text in it too (`DEFAULT_FONT_FAMILY` in
  `@remo/canvas`). Inter stays loaded as the fallback in that stack; a stored copy of a
  previous default stack moves to the new one.
- **Icons:** `src/icons.ts` is generated from `docs/design/assets/icons/icons.json`:
  110 icons, a 24 master with stroke 2 and a separate 16 grid with stroke 1.5
  (`ICONS_16`), filled parts in `ICON_FILLS` / `ICON_FILLS_16`. `Icon` picks the 16 grid
  at 16 px and below. Renamed: `cloud-check` → `saved`, `sparkle` → `agent`,
  `zoom-fit` → `fit`.
