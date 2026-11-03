## Palette: one for the rail, the bar and the selection

The palette answers "what colour is this object" the same way in the rail, on the object bar and on the selection bar. An object has several roles — sheet or fill, border, text, line and connector label — and each takes its value from this one palette. The value is stored in the object itself, so the board looks the same to every participant and after a reload.

## The tonal grid

Seven tones run in columns, three levels in rows. Levels 100 and 300 are fills; 600 is for lines, borders and text: a thin line and small text need contrast.

| Tone | 100 | 300 | 600 |
|---|---|---|---|
| Grey | Grey | Dark grey | Graphite |
| Yellow | Yellow | Ochre | Deep ochre |
| Orange | Orange | Carrot | Terracotta |
| Pink | Pink | Raspberry | Deep raspberry |
| Violet | Violet | Lilac | Deep violet |
| Blue | Blue | Sky | Deep blue |
| Green | Green | Grass | Deep green |

The tone name is the same word the colour sample shows on the object bar. One shade is never called two different things in different places.

## Named colours

White, black and transparent stand in a separate column to the left of the grid: they are not a level of a tone, but a value people ask for by name.

| Role | Where | What is offered |
|---|---|---|
| Sheet colour | the sticky note bar | White, Black |
| Fill | the shape bar; a multi-selection's shared fill | White, Black, Transparent |
| Border, connector line | the shape or connector bar; a multi-selection's shared line | Black, None |
| Text | the sticky note or shape bar | Auto, Dark, Black, White |
| Text | the text bar | Auto, Black, White |
| Text (connector label, when the connector has text) | the connector bar | Auto, Black, White |

A transparent fill is drawn as a checkerboard: it means "nothing is painted", not white. On a border or a line the same value is called **None**: the role itself is absent.

A sticky note has no transparency: its sheet is the object, and an invisible sticky note is a lost object.

## Where to change a colour

- **Rail.** The caret beside the **Sticky note** tool opens the palette for a new sticky note: 14 fills (100 and 300) plus White and Black. Yellow is marked as the default.
- **Object bar.** Click the colour sample: a sticky note offers **Sheet colour** and **Text**, a shape offers presets, **Fill**, **Border** and **Text**, text offers the **Text** role, and a connector offers **Line** and **Text** (the connector label).
- **Selection bar.** With several objects selected, the sample shows their shared fill or line. Mixed colours means the objects disagree: pick a colour to set one for all.
- **Colour window.** Every role lives in one window: the grid, named values, Custom colour and keys 1–7.

## Keys 1–7

A digit picks a tone, not a level, and paints the main role of the selection:

- sticky notes and shapes get a fill; the 100 or 300 row is kept, and when the objects sit on different rows the 100 row is chosen;
- a connector gets its line, always 600;
- text gets its colour, always 600.

A key works when only objects with that role are selected: sticky notes and shapes, connectors, or text. A mixed selection is not repainted halfway. In an input field, an open menu or a dialog, a digit stays a digit.

Named colours have no number: White, Black and Transparent are chosen with a button, not a key.

## Custom colour

When an object stores a value outside the palette — an old board's colour, for example — the window labels it **Custom colour** and shows the value below the grid. That is a label for the value, not a swatch to pick: only palette values can be chosen. The current colour is kept until you choose another: there is no migration, and the board is not repainted after the fact.

## Check the result

- The rail and the sticky note window show the same 14 fills in the same order, with White and Black in a separate column.
- The name on the sample matches the name of the chosen swatch in the window.
- After pressing 4, a sticky note becomes pink on its previous level instead of jumping to another row.
- An object with Custom colour stays that way until you pick a colour from the palette.

## Limitations

- Colour is a property of an object, not an access right: it does not change who may edit the board.
- A sticky note has no transparency; free text and a connector label have the Auto / Black / White control, while sticky note and shape text has Auto / Dark / Black / White.
- The palette does not change an object's type, layer or size.
- Keys 1–7 do not work while the focus is in an input field or a dialog is open.

## Where to go next

[The board screen](/guide/concepts/board-chrome) — where the palette lives on screen.

[Canvas and objects](/guide/capabilities/canvas) — size, text and how objects behave.
