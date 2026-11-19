## Two models

A frame and a kanban look similar — both group objects. But they are built differently, and this explains the different behaviour.

| | Frame | Kanban |
|---|---|---|
| What sets the position | object coordinates | cell and order within it |
| Moves with the container | yes | the card moves only between cells |
| Can be resized | yes, the contents are not scaled | no |
| Can be taken outside | yes, just drag it | no: the card is always in a cell |
| Can be an end of a connector | no | a card — yes: the line follows its cell |

```
frame                              kanban
┌────────────────────┐             ┌─────────┬─────────┐
│   ●      ●         │             │  card   │  card   │
│          ●         │             ├─────────┼─────────┤
└────────────────────┘             │  card   │         │
                                   └─────────┴─────────┘
objects move with the frame        a card belongs to a cell
```

## Frame

A frame is a container. An object whose centre lands inside the frame becomes part of it and moves with it; drag it outside and it lives separately again. If frames overlap, the object joins the smaller one. Frame bounds do not clip the object — it stays visible even if it has gone beyond the edge.

A frame can lie in a frame too. It becomes nested when it fits wholly inside another frame: for a frame, the centre is not enough. A nested frame moves with its parent, with everything in it, is drawn above its parent and is picked by a click inside it. When a frame is deleted and its contents kept, its nested frames and objects go to its own parent. A table section takes no frames: its objects live in cells.

When an object inside a frame gets bigger — a kanban grows with its cards, a shape grows for its text, a nested frame is stretched — the frame extends on the side the object crossed, with a small margin, and so do the frames above it. Dragging an object does not extend the frame: that is how an object is taken out. A frame never shrinks on its own, and a locked frame keeps its size.

A frame is useful when there are several sections and each one is a finished thought: "Sprint", "Backlog", "Risks".

A frame's size changes with the corner handles and means how much of the room a section covers. The contents are not scaled: objects keep their size, and after the boundary moves, membership is re-evaluated by the centre — an object may join the frame or leave it. The minimum size is 160 × 120.

## Kanban

A kanban is a grid: columns set the stage, swimlanes give an additional division (for example, by team). A card belongs to a cell; its position is determined by the order within the cell, not by coordinates.

That is why a card:

- is not dragged across the free canvas;
- can be an end of a connector; the line follows its cell;
- is created by double-clicking a cell, not with an "add object" button.

## Layers

Frames and kanbans lie below sticky notes and shapes, text is on top of everything. The order is set by the object type, not by what you dragged last: that way a caption does not end up accidentally under a sticky note.

## Where to go next

[Frames and kanban](/guide/capabilities/frames-kanban) — the practical side and the limits.
