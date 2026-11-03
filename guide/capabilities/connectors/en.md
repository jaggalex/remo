## What it gives

A line between two objects that stays attached to them and reroutes when the objects move. A connector shows a dependency, an order or a flow — something a position cannot express.

## When to use

- A process diagram: one step leads to the next.
- Task dependencies: what blocks what.
- An architecture diagram: one component is connected to another.

## How it works

1. Select an object with a single click: an anchor appears at the middle of each of the four sides.
2. Click an anchor. When the slot beside it is free, a connected copy of the object appears; when another connectable object stands there, the two are joined. Dragging from an anchor to the second object is another way to join them.

A connector remembers objects, not coordinates: when its ends move, the line is rebuilt. One pair of objects has one connector.

The ends can be a sticky note, a shape, text, an image, a sticker and a kanban card. A frame and a kanban cannot be ends.

When both ends of a connector fall inside a marquee selection, the line joins the selection and moves with the set. A line with one end outside the selection is not added.

## Routing and shape

| Parameter | Values |
|---|---|
| Routing | straight, elbow, curved |
| Arrow | no arrow, at the end, at both ends, at the start |
| Waypoints | up to 32 waypoints |

A waypoint is added by dragging a segment of the line; a double click on a waypoint deletes it and joins the segments again. Moving an end onto another object re-attaches the connector.

## Example

Input: three sticky notes "Request", "Check", "Response". Action: connect "Request" → "Check" and "Check" → "Response", set the elbow routing. Result: a diagram of two lines that does not fall apart when the sticky notes move.

## Limitations

- A connector from an object to itself is forbidden.
- One pair has one connector; the second one has to be changed, not added.
- The waypoint limit is 32 per connector.
- A kanban card can be the end of a connector; the line follows its cell.

## Keyboard: walking the waypoints

A selected connector can be walked without a mouse: the focus moves along its fixed waypoints, and the arrows move the focused one.

| Action | Keys |
|---|---|
| Next waypoint | `Tab` |
| Previous waypoint | `Shift` + `Tab` |
| Move by 1 px | arrows |
| Move by 10 px | `Shift` + arrows |
| Delete the waypoint | `Delete` or `Backspace` |
| Leave the walk | `Esc` |

The walk covers fixed waypoints only: connector ends and automatic midpoints are not part of it. When a connector has no fixed waypoints, `Tab` does not start the walk. Anchors and creating a new connector are done with a mouse or a trackpad.

## Practical instructions

[Assemble a planning board](/guide/start/first-scenario) — connectors in a working scenario.

## Related capabilities

[Anchors and routing](/guide/concepts/connectors), [canvas and objects](/guide/capabilities/canvas), [agents](/guide/capabilities/agents), [export](/guide/capabilities/export).
