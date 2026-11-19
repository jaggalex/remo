## What happens to a change

A change is applied locally at once: you see it in the same frame. Then it goes to the server and becomes visible to other participants. **These are two different moments**, and the save indicator shows the second one.

| What you see | Meaning |
|---|---|
| connecting | the connection is being established, the room is not synced yet |
| saving | there are changes the server has not accepted yet |
| saved | the server confirmed the write |
| offline (N) | no connection, N changes wait in the queue |
| input stopped | the queue reached its limit, editing stopped |

## Conflicts

Two people can change one room at the same time. Changes merge rather than overwrite each other: the order of operations is preserved, and the last one in time does not "win" entirely. Practical consequence: edits to different objects do not conflict, and edits to one object are applied in the order in which the server saw them.

## Offline

Without a connection, edits stay local and are sent once the connection is restored. The queue is limited: after the limit the tab stops accepting changes and shows a warning. This protects against a situation where, after a page reload, more is lost than can be restored.

:::tip
While the indicator shows offline, unsent edits live in the tab's memory. Reloading before the connection returns loses them.
:::

## Access revocation

If access is revoked, the open socket is closed. The client reconnects and receives read-only mode. Edits already made are not rolled back.

## What the server confirms

The server responds to an accumulated change number, not to every movement: one confirmation covers everything up to that number. That is why the interface has no "saved N times" counter — only the fact "everything up to this point is written".

## Where to go next

[Saving and offline: what the model gives](/guide/capabilities/sync) — and where its limit is.
