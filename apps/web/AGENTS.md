# apps/web — what is different here

Additive to [`AGENTS.md`](../../AGENTS.md).
Nothing below repeats a rule that is already written there.

## Shape

- React 18 + Vite, no build step for the workspace packages: `@remo/ui`, `@remo/model`,
  `@remo/canvas`, `@remo/doc` are imported from source.
- `main.tsx` imports `@remo/ui/styles.css` and then `./styles.css`. The product stylesheet is
  one entry with `@import`s into `src/styles/*.css` (ADR-134) — **the import order is the
  cascade**; a later file wins at equal specificity.
- Rendering is Canvas 2D (`packages/canvas`), not the DOM. A DOM node is only used for
  inline text editing and for panels.

## Rules that bite

- **No colour or size literals.** Colours come from `var(--…)` tokens; a paint value a
  *document* stores comes from `src/objectDefaults.ts`. `pnpm ui:check` fails anything else,
  and `src/styles.test.ts` fails a literal inside the CSS.
- **Every user-visible string is a key** in `src/i18n/` (RU and EN). A missing translation
  fails `tsc` — that is the enforcement, not a convention.
- **A new file above 800 lines fails `pnpm size:check`.** Split by reason to change.
- **`App.tsx` and `BoardCanvas.tsx` are near the limit** (786 and 777). A feature that needs
  more room in either starts with a split; ADR-093 records the ratchet and the previous
  were done.

## Testing here

- Pure modules keep a `*.test.ts` beside them (`settings`, `clipboard`, `voteModel`, …).
- Anything that renders is covered by a browser scenario in `e2e/`, not by a DOM test.
- A visual change updates `spec/baselines/` deliberately: `pnpm baselines`, then look at the
  PNG before committing it.
