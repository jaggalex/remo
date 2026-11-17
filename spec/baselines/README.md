# Product visual baselines

PNG evidence for the screens and canvas states the product promises. They are Linux renders
from Chromium in the Playwright image, and `pnpm e2e:visual` compares every screen against
them (ADR-222). A deliberate visual change regenerates them in the same pull request:

```bash
pnpm test:db:up
pnpm baselines
```

| File | What it shows |
|---|---|
| `connector-straight.png` | A straight connector between two notes |
| `connector-elbow.png` | An elbow with different endpoint heights |
| `connector-curved.png` | A curved connector with different endpoint heights |
| `connectors.png` | The three routings on one canvas (overview) |
| `board.png` | The board at 1440×900 with the inspector and a note |
| `export.png` | The export dialog: scope, format, object count |
| `timer.png` | The shared timer panel and its countdown |
| `vote.png` | A voting session with two objects and the quota |
| `topbar-board-menu.png` | The board's menu: rename, settings, export, restore, a copy, trash |
| `topbar-facilitation.png` | «Фасилитация ▾»: timer, voting, follow along and the reactions row |
| `topbar-more.png` | «Ещё ▾»: templates, AI, apps, the planned Story |
| `topbar-account.png` | The account menu: name and role source, cursor name, theme, language |
| `topbar-dark.png` | The same header in the dark theme with a menu open |
| `rail.png` | The tool rail: two panels — tools with the pressed Select, history below |
| `rail-dark.png` | The same rail in the dark theme |
| `canvas-bottom.png` | The bottom edge: zoom with fit, and the one-time hint in its own slot |
| `vote-chips.png` | Two counters on a note and its neighbour: «0 +» and «1 · ваш − +» |
| `vote-chips-dark.png` | The same counters in the dark theme: plate, my accent, the muted disabled «+» |
| `vote-chips-overview.png` | The fitted room during a vote: each counter is only its number, and no object is covered (ADR-235) |
| `agent-plan.png` | The plan preview in the room (ADR-188): two dashed notes joined by a dashed line, and the task panel with counts and bounds |
| `agent-plan-tidy.png` | The tidy preview in the room: five notes, their dashed ghosts in one column, the US block hull and the task panel |
| `section-panel.png` | A section in table view with its panel: view, axes and the top of the Header group |
| `section-panel-header.png` | The Header group scrolled into view: empty sizes read «Auto», with no unit |

The automatic gate is **not** a byte comparison (ADR-091): macOS and Linux rasterize
text differently. `e2e/visual.spec.ts` samples pixels where the three routings must
differ, checks that every screen fits 1440×900, and `e2e/a11y.spec.ts` runs axe. The
PNGs are reviewed by a person; a pixel diff can be added when a Linux baseline job
exists.
