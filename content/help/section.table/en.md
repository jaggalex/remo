## Result

A section (frame) can be shown as a table: it gets columns and rows, and objects stay in cells. The free view and the table are two views of one section; text, links, comments and the objects themselves are neither copied nor lost.

## Steps

1. Select the section and open **Properties**.
2. In the **View** group choose **Table**. A column with the existing material and an empty column appear, plus a row.
3. **+ Column** and **+ Row** add axes. Choose an axis in the panel or by clicking its header on the canvas; clicking the header again opens its menu: rename, insert a neighbour, move, turn, size, delete.
4. A double click on a header (or Enter/F2) edits the title in place: Enter commits, Tab moves to the next header, Esc cancels.
5. If an axis holds objects, deleting it asks first: move them to the neighbouring axis (the default) or delete them with the axis.
6. **Remove table** returns the free view; cells are remembered, and turning the table on again restores the structure.
7. **Delete section** removes only the frame: the objects stay on the canvas.

## Check

- After any action and after "Remove table" → "Table" the texts, links and positions are intact.
- Deleting an axis with objects asks and moves them to a neighbour by default.
- "Remove table" does not delete objects.
- One `⌘Z` / `Ctrl+Z` undoes the whole action.

## Limits

- A table is a view of a section, not a separate object; kanban stays a different tool.
- Objects cannot yet be dragged between cells on the canvas: they land in the first cell when the table is turned on, and moving between cells is the next step.
- A table does not change access: the room is still the unit of access.
