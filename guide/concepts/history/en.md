## Four mechanisms, four different promises

| Mechanism | What it returns | Where it lives | Survives a reload |
|---|---|---|---|
| Undo / redo | the last edit | tab | no |
| Trash | the whole room | server | yes |
| Copy | a new room with the same content | server | yes |
| Backup import | state from a file, replacing the room | file | yes |

They are easy to confuse, so what matters is exactly what each one promises.

## Undo

The undo history is a stack of edits of the current tab. It is not shared: two people can undo their changes independently. After a reload the stack starts again, so undo is a tool for "right now", not a way to roll back a day.

Deleting an object together with the connectors that led to it is one edit: undo returns both the object and the connectors.

## Trash

The trash stores a **room**, not an object. A room in the trash does not open by link and is not considered active. There is no automatic purge: it can be restored while it is in the trash. Only the owner can restore it.

## Copy

A copy creates a new room with a new address and the same content. The original does not change. The copy carries the participants' access; the person who copied becomes the owner, and the public link is off on the copy. A copy is useful before a major restructuring, but it is not a backup: both rooms live in the same storage.

## Import

Import replaces the room with the content of a file in one action. It is the only mechanism that restores state from an external source, and the only irreversible one.

## Where to go next

[History, trash and copy](/guide/capabilities/history) — how this looks in practice.
