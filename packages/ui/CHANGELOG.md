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
