## Result

The file contains exactly the chosen scope — the selected objects, one frame with its
contents, or the whole board — together with the connectors inside it. The dialog shows
the object count.

## Scopes

- **Selection** — the objects selected right now, and the connectors between them. If a frame or a kanban is selected, its child objects are included too.
- **Frame** — the frame that contains the selected object, with everything inside it. If no frame is selected and the selection is not inside one, the option is unavailable.
- **Whole board** — every object. This option is chosen explicitly; the dialog never substitutes it for a selection.

## Connectors in the scope

A connector is a relation between two objects, not a third object, so it goes into the
file together with both of its ends. A marquee drawn around two objects selects the
connector between them too.

- A connector whose other end is outside the scope is left out of the file: a line cut at the edge would claim a relation to an object the picture does not show.
- A connector between two cards of the same kanban counts as internal when the kanban is in the scope.
- A connector selected on its own is exported as before — clipped at the picture edge.

## Steps

1. Open the board menu (the board’s name) and choose Export….
2. Choose a scope. The object count is shown under the options.
3. Choose a format and click Export.

## Check the result

- The picture has no grid, selection outlines or other people's cursors: those are screen chrome, not the board.
- The object count in the dialog, connectors included, matches what the file shows.
- Choosing Selection with nothing selected leaves the export button disabled.

## Limits

- A very large board is exported at a lower resolution but in full: the limit protects the browser from running out of memory.
