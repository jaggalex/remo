## Result

A section (frame) can be shown as a table: it gets columns and rows, and objects stay in cells. The free view and the table are two views of one section; text, links, comments and the objects themselves are neither copied nor lost.

## Steps

1. Select the section and open **Properties**. A section just created with **Gather into section** opens the panel for you.
2. In the **View** group choose **Table**. A column with the existing material and an empty column appear, plus a row.
3. **+ Column** and **+ Row** add axes. Choose an axis in the panel or by clicking its header on the canvas; clicking the header again opens its menu: rename, insert a neighbour, move, turn, size, delete.
4. A double click on a header (or Enter/F2) edits the title in place: Enter commits, Tab moves to the next header, Esc cancels.
5. Drag an object or a selection to another cell: it lands there keeping its relative arrangement. A header does not take objects. The same move is available as **Move to cell…** in the selected object's properties.
6. If an axis holds objects, deleting it asks first: move them to the neighbouring axis (the default) or delete them with the axis.
7. **Remove table** returns the free view; cells are remembered, and turning the table on again restores the structure.
8. **Delete section** removes only the frame: the objects stay on the canvas.

## Long titles

Column and row titles wrap by words; the header grows for a vertical or multi-line title and the row strip grows for a long name. Text longer than 100 characters is shortened with an ellipsis. Text is never squeezed or distorted.

## Keyboard and screen reader

Table headers are keyboard reachable: `Tab` moves between them, `Enter` or `F2` edits the title, `Enter` commits, `Esc` cancels, and `Shift+F10` opens the axis menu. A screen reader reads the section as a table: columns, rows and cell contents; the selected axis is announced separately. **Move to cell…** also works from the keyboard.

## Check

- After any action and after "Remove table" → "Table" the texts, links and positions are intact.
- A move into a cell keeps the objects' relative arrangement and undoes with one ⌘Z.
- Deleting an axis with objects asks and moves them to a neighbour by default.
- "Remove table" does not delete objects.
- One `⌘Z` / `Ctrl+Z` undoes the whole action.

## Limits

- A table is a view of a section, not a separate object; kanban stays a different tool.
- Objects cannot yet be dragged between cells on the canvas: they land in the first cell when the table is turned on, and moving between cells is the next step.
- A table does not change access: the room is still the unit of access.
