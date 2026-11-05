## When you need it

You need to protect an object from accidental edits and deletion while the team works around it. A lock does not remove access to the room: it pins the object and records who locked it.

## Prerequisites

- You are signed in and may edit the room.
- The object is selected.

## Steps

1. Click **Lock** in the object menu or press `⌘⇧L` / `Ctrl+Shift+L`. Result: the object can be selected but not moved or edited; its info shows the author of the lock.
2. To release it, click **Unlock**. The author or a room manager can do this.
3. If the lock belongs to somebody else, the interface names the author and refuses the action.
4. **Unlock everything you can** releases your locks; for a manager, every lock.

## Check

- A second editor cannot move the object, change its text or delete it.
- The author releases the lock; a room manager releases somebody else's.
- A copy and a duplicate appear unlocked.
- After a reload the lock and its author are still there.

## Limits

- This is coordination, not an ACL: a direct write client can bypass the lock.
- An old lock with no author is released by any editor until it is toggled.
- A lock on a frame does not protect its contents; lock the whole group instead.
- A locked object stays readable, exportable and usable as a connector endpoint.

## Where to go next

[Discussion in comments](/guide/how-to/comment) — how to leave feedback on an object.
