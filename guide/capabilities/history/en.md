## What it gives

Three different ways back: **undo** for the last edit, **trash** for the whole board, **copy** for a safe experiment.

## When to use

- Undo — right after a mistake.
- Trash — when the board is no longer needed, but it is too early to delete it for good.
- Copy — before a large restructure, or for a template.

## How it works

**Undo and redo** act on edits in the current tab: the history lives in the browser and starts over after a reload. A restored object comes back with the connectors that were deleted together with it.

**Trash** is an archive of the board, not the deletion of an object. A board in the trash does not open by link and does not count as active. The interface shows 90 days, but there is no automatic purge; only the owner can restore it.

**Copy** creates a new board with the same content and a new address. The original does not change; participants' access is carried over, the person who copied becomes the owner, and the public link is off on the copy. Only an owner or co-owner (`board.manage`) can create it.

## Example

Input: a board with three objects. Action: delete an object, press undo, then make a copy of the board. Result: the object is back, and the copy opens at its own address and lives separately.

## Limitations

- Undo does not survive a page reload.
- The trash shows 90 days, but there is no automatic purge; restore works while the board is in the bin.
- A copy carries participants' access; the public link is off on the copy.
- Restoring from a backup replaces the board entirely — that is not the same as undo.

## Practical instructions

[Export a result and restore a board](/guide/how-to/export-backup) — a backup as insurance.

## Related capabilities

[History and recovery](/guide/concepts/history), [canvas](/guide/capabilities/canvas), [export](/guide/capabilities/export), [access](/guide/capabilities/access).
