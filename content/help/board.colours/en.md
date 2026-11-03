## Result

An object has several roles: sheet or fill, border, text, line and connector label. Each takes its value from one palette — seven tones at three levels plus white, black and transparent. A colour is changed on the object bar, in the rail or with keys 1–7, and has the same name everywhere.

## The grid

Seven tones run in columns: grey, yellow, orange, pink, violet, blue, green. Levels 100 and 300 are fills; 600 is for lines, borders and text.

| Tone | 100 | 300 | 600 |
|---|---|---|---|
| Grey | Grey | Dark grey | Graphite |
| Yellow | Yellow | Ochre | Deep ochre |
| Orange | Orange | Carrot | Terracotta |
| Pink | Pink | Raspberry | Deep raspberry |
| Violet | Violet | Lilac | Deep violet |
| Blue | Blue | Sky | Deep blue |
| Green | Green | Grass | Deep green |

## Named colours

White and Black stand in a separate column to the left of the grid. A shape's **Fill** also offers **Transparent**, and a **Border** or a **Line** offers **None**: both are the same stored value, but a role without a fill and a role without a line are named differently. Transparent is drawn as a checkerboard.

A sticky note has no transparency: its sheet is the object.

## Where to change a colour

- **A new sticky note.** The caret beside the Sticky note tool in the rail opens the palette: 14 fills plus White and Black. Yellow is marked as the default.
- **A sticky note.** Click the sample on the object bar to open **Sheet colour** and **Text**.
- **A shape.** The sample opens presets, **Fill**, **Border** and **Text**.
- **Text.** On a sticky note or a shape the **Text** role offers **Auto, Dark, Black, White**; on free text it offers **Auto, Black, White**.
- **A connector.** The sample opens **Line**, and when the connector has text, also **Text** (the connector label): **Auto, Black, White**.
- **Several objects.** On the selection bar the sample shows the shared fill or line. Mixed colours means the objects disagree.

## Keys 1–7

A digit picks a tone and paints the main role of the selection:

- sticky notes and shapes get a fill; the 100 or 300 row is kept, and different rows fall back to 100;
- a connector gets its line, always 600;
- text gets its colour, always 600.

A key works when only objects with that role are selected. In an input field, a menu or a dialog, a digit stays a digit. Named colours have no number.

## Custom colour

A value outside the palette is labelled **Custom colour** below the grid. That is a label for the value, not a swatch to pick: only palette values can be chosen. The current value is kept until you choose another: the board is not repainted after the fact.

## Check the result

- The rail and the sticky note window show the same 14 fills in the same order, with White and Black in a separate column.
- The name on the sample matches the name of the chosen swatch in the window.
- After pressing 4, a sticky note becomes pink on its previous level.
- An object with Custom colour stays that way until you pick a colour from the palette.

## Limitations

- Colour does not affect access rights.
- A sticky note has no transparency; free text and a connector label have the Auto / Black / White control, while sticky note and shape text has Auto / Dark / Black / White.
- The palette does not change an object's type, layer or size.
