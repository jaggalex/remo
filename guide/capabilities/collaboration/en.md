## What it gives

Every participant sees the changes of the others in real time: cursors, selection, presence. Nothing has to be saved by hand or refreshed in the browser.

## When to use

All the time. There is no separate "collaboration" mode: a room is collaborative by default if people have access.

## How it works

Every participant holds a connection to the room; edits go to the server and arrive at the rest. The cursor and presence are a separate stream; it does not change the document.

**Follow** is following one specific session of a participant (a tab or a device): your view repeats that session's camera. Follow stops from either side: you can leave, and the person being followed can stop their followers.

**Bring everyone to me** is an invitation: each person gets a "Follow / Stay" question and decides. When automatic following is enabled, the view moves at once, without a question. It is available when the room allows it.

**Discussion** is a server thread on an object or a point. A pin on the canvas marks the place, a reply reopens a resolved thread, unread threads are visible in the panel. The **Commenter** role may read and discuss without changing objects; a link visitor does not see threads.

**Live reactions** are six emoji, a burst near the cursor. They are an attention signal, not a record: no counter, history or badge on the object.

**A lock** protects an object from edits and deletion. It records its author; the author or a room manager releases it. A copy and a duplicate appear unlocked. This is coordination, not an ACL.

## Example

Input: two participants on one room. Action: the first one turns on follow on the second. Result: the camera of the first repeats the movements of the second until one of them stops follow.

## Limitations

- A participant with read-only permission sees changes but does not send their own.
- Follow grants no rights: it shows what the person could open anyway.
- Comments are online; a reply draft is kept and sending waits for the network.
- Reactions are not stored and are not in a backup.
- A lock is not a per-object permission: a raw client with `board.edit` can bypass it.
- When access is revoked, the tab goes into read mode.

## Practical instructions

[Quick start](/guide/start/quickstart) — check collaboration between two people.
- [Work together on one room](/guide/how-to/work-together) — follow, offline and a check.

## Related capabilities

[Presence and follow](/guide/concepts/presence), [access](/guide/capabilities/access), [saving](/guide/capabilities/sync), [facilitation](/guide/capabilities/facilitation).
