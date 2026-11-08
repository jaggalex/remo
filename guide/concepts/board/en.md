## Model

A room is a document with objects. An object has an identifier, a type, a size, a position, and, for text types, text. The type defines behaviour: a sticky note moves freely, a card lives in a kanban cell, a connector joins two objects.

| Type | Moves | Contains text | Can be a connector end |
|---|---|---|---|
| Sticky note | yes | yes | yes |
| Shape | yes | yes | yes |
| Text | yes | yes | yes |
| Frame | yes | no | no |
| Kanban | yes | no | no |
| Card | inside a cell | yes (title) | yes, through its cell |
| Connector | no | yes | no |

A sticky note, text, shape and frame resize with the corner handles. In a sticky note and a shape the text fits the rectangle; in a frame the contents keep their size and membership is re-evaluated by the centre. In detail — [frames and kanban](/guide/concepts/frames) and [canvas](/guide/capabilities/canvas).

## Layers and order

Objects lie in layers: kanban and frames below, sticky notes and shapes above, text on top of everything. The order is set by type, not by what you dragged last. That is why a label does not end up under a sticky note by accident.

## Coordinates and camera

The room world is infinite. The camera defines what is visible: position and scale. An object that leaves the screen is not lost — it stays in its place in the world, and the camera looks at another point. This gives a practical rule: **do not move the camera to "bring an object back"** — use zoom and the room overview.

## Selection

The selection is a temporary set of objects: it is not stored in the room and other participants do not see it. Therefore:

- the selection rectangle captures what falls inside it; when both ends of a connector fall inside, the connector joins the selection with them;
- delete, move, and align act on the whole set;
- the selection survives a redraw and does not depend on who else is looking at the room.

A connector with one end outside the selection is not added: a line without its second object is not a separate object but a broken relation. Copying and export apply the same rule.

## Frames and kanban

A frame is a container: an object inside it moves with it. A kanban is a grid of cells: a card belongs to a column and a swimlane, and its position is set by the order in the cell, not by coordinates on the canvas. These are different models, and the interface behaves differently.

## What is not here

- **Per-object permissions.** The room is the unit of access; a lock coordinates edits and
  is not an ACL.
- **Nested comments.** A thread is flat: a root and replies.
- **Mentions and notifications** in comments.
- **Layers with independent hiding.** Order exists; hiding a layer does not.

## What else an object carries

| Capability | Where it lives |
|---|---|
| Status, assignee, date range | card fields; a kanban column is a separate place |
| Tags | room vocabulary, `tagIds` on the object |
| Link | one field: an external URL or another room object |
| Lock | a flag and an author; the author or a room manager releases it |
| Comments | a server thread anchored to an object or a point |
| Name and ID | an optional name up to 120 characters; a read-only ID that can be copied |
| Reactions | a live burst near the cursor; not stored |

## Where to go next

[/guide/capabilities/canvas](/guide/capabilities/canvas) — what the canvas gives you and where it ends.
