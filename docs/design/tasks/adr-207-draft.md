## ADR-207: A section shows its title and a view badge on the canvas (amends ADR-201; extends ADR-196, ADR-199, ADR-206)

**Status:** accepted (2026-11-12); moved into `ADR.md` as ADR-207. Mockups are the T series
(T1, T4, T5, T9, T10, T13, P7); Figma is not required — frames and redlines are the handoff.

**Context.** ADR-196/199/201/204/206 describe a table section, but a person meets it only
through the properties panel: `frame.title` is stored, exported and shown in the panel, and
never drawn on the canvas; the view is switched in the panel alone. The owner's review of
the T series (12.11.2026) asked for the name above the section with a "▦ Table" badge
beside it, and T4/T10 show two moments the code does not have — a layout dialog and a
remove confirmation. ADR-201 says "Table" in the section's properties "stays the only
entry"; this record amends that sentence and keeps its rule: a table is a view of a
section, not an object, and there is still no Table tool on the rail.

**Decision.**

- **The title is chrome, in screen space.** It sits above the section's top-left corner,
  outside its box, at a screen-constant size that does not scale with zoom (the same family
  as selection handles). It never enters the table rectangle and is not read by
  `layoutTable`, tidy, reflow, export, backup or presentation in v1. A long title is
  clipped with an ellipsis, never wrapped; the full text is in the editor and the tooltip.
  Below 20 % zoom the strip is hidden rather than drawn over the grid.
- **A non-empty title is always drawn**, muted; an untitled section shows the placeholder
  only on hover or selection. The title is content, the badge is an action, and the two
  have different volume (E2): the badge appears on hover or selection only.
- **The badge is a menu, not a switch.** In table mode, `▦ Table` follows the title. A
  click (or `Enter`/`Space` when focused) opens a small menu "Section / Table" with the
  current view checked. It calls the same helper as `SectionPanel.switchView`, including
  "the first column creates the axes". There is no badge in free mode; the canvas path
  there is the context-menu item. The segments stay in the panel — the badge is a state
  chip that opens a menu.
- **One command, three surfaces.** The panel switch, the badge menu and the context-menu
  item call one helper; no surface keeps its own state and no second mechanism appears.
  The section is selected, the object selection and the camera are untouched by a switch.
- **Title editing.** A double click, `F2` or `Enter` on a selected section opens the same
  in-place field as an axis header (ADR-202): all text selected, `Enter` or blur commits,
  `Esc` cancels, one command and one undo, an empty value clears to the placeholder. While
  editing, dragging and the badge are off. A single click selects the section; there is no
  drag by the title in v1 — the body moves the section. The strip accepts no objects and is
  not a drop target.
- **Entering the table with material asks how to lay it out (T4).** Turning a free section
  that holds objects and has no stored axes into a table opens "How to lay out the
  material?" with "Lay out by current position" / "Keep everything in the first cell", a
  live preview on the canvas and Cancel/Apply. The preview comes from the same pure plan as
  the command (ADR-201, gather), so the picture and the result cannot disagree. Apply is one
  command and one undo. The default is "keep everything in the first cell": it is today's
  behaviour and creates no axes nobody asked for. An empty section, or one whose
  `active: false` table is turned back on, opens no dialog. This settles ADR-196 H4 for the
  manual path: the person chooses, the default is the safe one.
- **Removing a table asks in the panel and not in the badge (T10).** `Remove table` in the
  panel confirms, naming the number of objects that stay on the canvas and that cells are
  kept so the table can be turned back on. The badge and context menus switch at once and
  report with a toast "Table removed, cells kept" — the label already states the outcome.
  Both paths run one command; the question belongs to the surface, not to a second
  mechanism. One undo restores the table.
- **Locked or read-only.** The title is not editable (no field, no pencil) and the badge
  menu and context item are disabled with the reason "The section is locked"; the title
  text is still drawn.
- **Keyboard and screen reader.** `Tab` goes title → badge → canvas; `Enter`/`Space` on the
  badge opens the menu, arrows move, `Enter` applies. The title is a text field with the
  axis header's announcements; the badge announces "Section view: Table". The strip has its
  own hover, selected and focus ring; selecting the section still outlines the grid.
- **Tokens and i18n.** Sizes, colours and radii come from the `@remo/ui` chrome tokens, never
  literals; every string is RU and EN in `apps/web/src/i18n` (a missing translation fails
  `tsc`). The strip and badge must not overlap the "+" handles on header boundaries
  (ADR-201): the strip sits above the box with a token gap.

**Consequences.** The painter and hit-testing gain a screen-space chrome layer for the
title strip and badge; the view switch is extracted into one helper used by the panel, the
badge and the context menu; the layout dialog reuses the plan-preview mechanism of
"Gather into section"; the remove confirmation joins the existing axis-deletion dialog
pattern. No document or schema change: `frame.title` already exists and is already
exported, so backups and older clients are unaffected and the schema version does not move.
Product baselines are regenerated deliberately (`pnpm baselines`), because every titled
section on every board now shows a strip. ADR-201's "only entry" sentence is superseded;
its table model, commands and geometry stand. Export and presentation keep ignoring the
title; exporting it later is a new record. New e2e scenarios: title edit and undo, badge
switch equals the panel switch, layout dialog preview, remove confirmation versus toast,
locked section.

**Help page outline** — `content/help/section.table` gains a short section "Название и
вид" / "Title and view" (RU is the source, EN required; `pnpm docs:check` gates it). Do not
edit the help page in this change.

- Steps: the section's name is above it; double click or `F2` renames it; the "▦ Table"
  badge and the context menu switch the view, as does the panel; a section with material
  asks how to lay it out; "Remove table" asks in the panel, keeps cells and objects.
- `section.title.placeholder` — Раздел / Section
- `section.title.rename` — Переименовать раздел / Rename section
- `section.view.label` — Вид раздела / Section view
- `section.view.toTable` — Показать как таблицу / Show as table
- `section.view.toFree` — Показать как раздел / Show as section
- `section.view.removed` — Таблица убрана, ячейки сохранены / Table removed, cells kept
- `section.view.locked` — Раздел заблокирован / The section is locked
- `section.layout.title` — Как разложить материал? / How to lay out the material?
- `section.layout.byPosition` — По текущему расположению / Lay out by current position
- `section.layout.firstCell` — Оставить всё в первой ячейке / Keep everything in the first cell
- `section.layout.preview` — Предпросмотр на холсте / Preview on the canvas
- `section.remove.title` — Убрать таблицу? / Remove the table?
- `section.remove.body` — Объекты останутся на холсте; ячейки сохранятся, таблицу можно
  вернуть. / Objects stay on the canvas; cells are kept and the table can be turned back on.
- `section.remove.confirm` — Убрать таблицу / Remove table
