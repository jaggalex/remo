## What it gives

Two ways to bring order: a **frame** groups objects into a section, a **kanban** lays cards out in columns and swimlanes.

## When to use

- A frame — when there are several sections and they move as a whole.
- A kanban — when the status or the stage matters, not the coordinates.

## How it works

A **frame** is a container. An object inside a frame moves with it and does not go beyond its boundaries when the frame is dragged.

**Frame size** changes with the corner handles. The contents are neither scaled nor moved: the frame grows or shrinks while objects keep their size and position. After a resize, membership is re-evaluated by the centre: an object whose centre is now outside leaves the frame, and an object whose centre is inside joins it — the smallest suitable frame wins. A frame is at least 160 × 120: below that its title and an object inside do not fit. The size and the new membership are undone with one ⌘Z.

A **kanban** arrives as the **Kanban room** template from **More ▾ → Templates…**: the columns and swimlanes are already there. A card is created by a double click on a cell; a double click on a card opens it for editing. A card belongs to a cell: its position sets the order in the column, not the coordinates on the canvas.

A **section table** is the frame's second view. The section's title sits above it on the left; a double click, `F2` or `Enter` renames it, and the **Table** badge after the title opens the **Section / Table** menu. The same switch is in **Properties** and in the context menu. If a free section holds objects, turning the table on asks how to lay out the material — by its current position or everything in the first cell — and shows a preview on the canvas.

In the table the objects stay in cells; text, links and comments are not copied. **+ Column** and **+ Row** add axes; an axis can be renamed, sized, have its column or row header turned, duplicated, moved or deleted. A header may hold several lines (`Shift+Enter` while editing), a row header can be turned vertical too, and the header width and height can be set as numbers or left on Auto. Each axis has **Auto** (follows the content) and **Manual** (never shrinks on its own); dragging a boundary turns Manual on and a double click returns to Auto. A cell is selected with a second click, `Shift+click` makes a range; a range can be **merged**, and a merged cell **split**. Objects can be dragged between cells keeping their relative arrangement; a header does not take objects, and **Move to cell…** does the same without dragging. **Table appearance** holds fills, borders and padding for the table, headers, the selected axis or cell. **Remove table** asks for confirmation and remembers the cells; the badge switches at once and says the cells are kept. **Delete section** removes only the frame.

## Card fields

A card carries more than a title: a status (to do, in progress, done), one assignee, a
start-to-due range and tags. Status is a card field, the column is its place in the kanban;
moving a card between columns does not rewrite the status. A column WIP limit shows
`N / limit` and warns on overflow without blocking the move.

## Example

Input: an empty room. Action: add the **Kanban room** template, create a card in the first column, set its status and assignee, drag it to the second. Result: the card has changed its column, and its status, assignee and text have stayed.

## Limitations

- A card does not move across the free canvas: it lives in a cell.
- A card can be the end of a connector; the line follows its cell.
- A card filter by assignee and due date exists: it lives in the **Properties** panel and does not hide objects. **Select cards** selects the matches, and the ordinary commands then act on them. There are no saved views.
- A sticky note dragged into a kanban does not become a card — it stays a sticky note above the grid.
- A border applies to the whole cell; there are no per-side borders.
- A table does not change access: the room is still the unit of access.
- A frame and a kanban are never the ends of a connector.

## Practical instructions

[The first complete scenario](/guide/start/first-scenario) — a kanban at work.

## Related capabilities

[Container versus grid](/guide/concepts/frames), [canvas](/guide/capabilities/canvas), [connectors](/guide/capabilities/connectors), [collaboration](/guide/capabilities/collaboration).
