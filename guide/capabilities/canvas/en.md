## What it gives

A free field where the team thinks: sticky notes for ideas, shapes for diagrams, text for labels, frames for grouping. All of it is visible to every participant in real time.

## When to use

- Collect ideas before a structure appears.
- Draw a diagram of a process or an architecture.
- Run a meeting where people add sticky notes in parallel.

## How it works

An object has a type, a position, and a size. The type defines whether it can be connected and whether it contains text. Layers are set by type: text is always on top, frames and kanban are below. In detail — [/guide/concepts/board](/guide/concepts/board).

**Size.** A sticky note, text, shape and frame resize with the corner handles. In a sticky note and a shape the text fits the new box instead of being stretched, while an explicitly set text size is kept; in a frame the contents keep their size and position, and membership is re-evaluated by the object's centre. The size and the membership change in one undo step.

**Colour.** An object has several roles — sheet or fill, border, text, line and connector label — and all take values from one palette: seven tones at three levels plus named White, Black and Transparent. A fill with no colour is called **Transparent**, while a border or a line is **None**. Change a colour with the sample on the object bar, the palette in the rail or keys 1–7; details are in [/guide/concepts/colors](/guide/concepts/colors).

## Example

Input: three sticky notes and one frame. Action: drag the sticky notes inside the frame, then move the frame. Result: the sticky notes move with the frame, and their relative position is preserved.

## What you can configure

- grid and snapping to it;
- the snap threshold to the edges and centers of neighbours;
- camera scale and position;
- room template on creation;
- an object's colour and size.

## Limitations

- Group operations act on the selection; the selection is a set of identifiers, not a property of an object.
- Objects have no permissions of their own: everything is decided on the room.
- Comments exist, but live in a separate server thread anchored to an object, not in the room document.

## Practical instructions

- [/guide/start/first-scenario](/guide/start/first-scenario) — assemble a planning room.
- [/guide/how-to/build-board](/guide/how-to/build-board) — build a room step by step.
- [/guide/concepts/colors](/guide/concepts/colors) — the palette and keys 1–7.
- [/guide/how-to/export-backup](/guide/how-to/export-backup) — take the result out.

## Related capabilities

[Connectors](/guide/capabilities/connectors), [frames and kanban](/guide/capabilities/frames-kanban), [export](/guide/capabilities/export).
