## What it gives

Two different results: an **artifact** for a person (PNG or PDF) and a **backup** for recovery (JSON with all objects and connectors).

## When to use

- Show the result to those who have no access.
- Attach the diagram to a document or a task.
- Save the state before a major restructuring.
- Move the room to another instance.

## How it works

Artifact export selects a scope: selection, frame or the whole room. A backup always covers the whole room and carries objects, connectors, text, group names, tags, presentation order and the discussion. Backup import **replaces** the room entirely, including comments.

A PNG/PDF can include the discussion: enable **Include comments**, and a list of open threads appears below the room with numbered pins on the objects.

## Example

Input: a room with a frame "Sprint". Action: **Export** → **Frame** → **PDF**. Result: the file contains only the content of the frame, not the whole room.

## What you can configure

Scope (selection, frame, room) and format (PNG, PDF, backup). There are no other parameters — this is deliberate.

## Limitations

- An artifact requires the `board.export` permission; a backup requires `board.backup`. Neither is available through a public link.
- Import is irreversible: the room is replaced, old objects are not restored automatically.
- A backup is an open JSON file: it contains the room text, so store it as a working document.

## Practical instructions

- [Export and backup: step by step](/guide/how-to/export-backup) — take the result out and restore a room.

## Related capabilities

Access, saving, canvas.
