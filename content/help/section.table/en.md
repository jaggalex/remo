## Result

A section (frame) can be shown as a table: it gets columns and rows, and objects stay in cells. The free view and the table are two views of one section; text, links, comments and the objects themselves are neither copied nor lost.

## Title and view

The section's title sits above its top-left corner. Double-click the title, or press `F2` or `Enter`, to edit it: `Enter` or leaving the field commits, `Esc` cancels, and one ⌘Z undoes it. The title is the section's label, not an object: it is outside the table rectangle and never gets in the way of moving objects.

In table mode a **Table** badge appears after the title. Click it to open the **Section / Table** menu; there is no badge in the free view. The same switch is in **Properties** and in the section's context menu. Switching keeps the objects and the camera; **Remove table** in the panel asks for confirmation, while the badge switches at once and says the cells are kept.

## Steps

1. Select the section and open **Properties**. A section just created with **Gather into section** opens the panel for you.
2. Choose **Table**. If the section already holds objects, the **How to lay out the material?** question opens: lay it out by its current position or keep everything in the first cell. The canvas shows a preview; **Apply** is one undo step.
3. **+ Column** and **+ Row** add axes. Choose an axis in the panel or by clicking its header on the canvas; clicking the header again opens its menu: rename, insert a neighbour, move, turn, size, delete.
4. A double click on a header (or `Enter`/`F2`) edits the title in place: `Enter` commits, `Tab` moves to the next header, `Esc` cancels.
5. Click an empty part of a cell: the first click selects the section, the second selects the cell. `Shift+click` another cell selects a rectangular range; the arrow keys move the cell, `Shift+arrows` extend the range, `Esc` clears it.
6. **Merge** appears above the range; a merged cell offers **Split**. The same actions live in the cell menu (right click or `Shift+F10`), together with inserting and duplicating rows and columns.
7. Drag an object or a selection to another cell: it lands there keeping its relative arrangement. A header does not take objects. The same move is available as **Move to cell…** in the selected object's properties.
8. If an axis holds objects, deleting it asks first: move them to the neighbouring axis (the default) or delete them with the axis.
9. **Remove table** returns the free view; cells are remembered, and turning the table on again restores the structure.
10. **Delete section** removes only the frame: the objects stay on the canvas.

## Sizes

Each axis has two modes. **Auto** follows the content both ways. **Manual** remembers the visible size: content may grow the axis, but the axis never shrinks on its own. Drag a header boundary to switch to **Manual**; a double click on the boundary or `Delete` returns to **Auto**. The **Narrow / Medium / Wide** presets are manual sizes. For a merged cell the panel switch applies to every column and row of the block; a mixed state is shown separately.

## Appearance

The **Table appearance** group holds fills, **Borders** and **Cell padding**. The area is chosen in the window: table, headers, the selected axis or the selected cell. A border has a colour, width and style (solid, dashed, no border); padding is small, medium, large or a number. **As before** restores the default. A border is drawn around the whole cell; padding changes how much room the content takes, and the cell grows around it.

## Long titles

Column and row titles wrap by words; the header grows for a vertical or multi-line title and the row strip grows for a long name. Text longer than 100 characters is shortened with an ellipsis. Text is never squeezed or distorted.

## Keyboard and screen reader

`Tab` moves through the section title, the view badge and the table headers; `Enter` or `F2` edits a title, `Enter` commits, `Esc` cancels. In the table the arrow keys move the selected cell, `Shift+arrows` extend the range, and `Shift+F10` opens the cell menu. A screen reader reads the section as a table: columns, rows and cell contents; the selected axis and the selected cell are announced separately. **Move to cell…** also works from the keyboard.

## Check

- After any action and after "Remove table" → "Table" the texts, links and positions are intact.
- Merge and split undo with one ⌘Z; objects from covered cells stay in the top-left cell.
- A move into a cell keeps the objects' relative arrangement and undoes with one ⌘Z.
- With auto size off an axis does not shrink after an object is removed; with it on the axis follows the content again.
- "Remove table" does not delete objects; the confirmation names how many objects stay.
- One `⌘Z` / `Ctrl+Z` undoes the whole action.

## Limits

- A table is a view of a section, not a separate object; kanban stays a different tool.
- A border applies to the whole cell; there are no per-side borders.
- A table does not change access: the room is still the unit of access.
