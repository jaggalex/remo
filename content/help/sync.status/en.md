## Result

The header shows one of three states: **Saved**, **Saving** or **Offline (N)**.

- **Saved** — the server confirmed that the edits are stored. It does not mean "stored in the browser": confirmation arrives over the socket after the server persists them.
- **Saving** — an edit was sent but is not acknowledged yet. This is usually under a second.
- **Offline (N)** — there is no connection; N edits are waiting. They stay in this tab and are sent after reconnect.

## Offline

1. If the connection drops, keep working: edits stay in the document.
2. When the connection returns, the status changes to **Saving**, then **Saved**.
3. Wait for **saved** before closing the tab.

If too many edits accumulate, input stops: the indicator shows **Offline · input paused**, and a message appears above the room. This protects the queue from growing without bound. Reconnect and wait for **Saved** to continue.

## Too many edits

The server limits the write rate. If there are too many edits in a short time, it closes the connection and shows the reason. What you entered stays in the current tab: closing the connection cancels neither text nor inserted objects. A message about changes coming too fast appears above the room.

1. Stop the bulk action: a paste, a bulk move, or a change to many objects at once.
2. Wait for reconnect. Before retrying, the client waits 5 seconds and doubles the pause up to 60 seconds.
3. Continue once the status changes to **Saving**, then **Saved**.

## The room is full

The room has a size limit. When it is reached, the server accepts only small changes: typing, moving and deleting go through, a large paste does not. The connection closes because the room reached its size limit; the paste stays in this tab and is not saved.

1. Delete unneeded objects or large fragments from the room.
2. Wait for reconnect: the pause before retry starts at 30 seconds and doubles up to 5 minutes.
3. Paste again in smaller parts.

## Too many objects

A separate limit is the object count: 20,000 per room. When it is reached, the server does not accept new objects, but existing ones can be changed, moved and deleted. This is not the size limit: a room can take little space and still hit the object count. The connection closes as it does for a full room, but the cause is different.

1. Delete unneeded objects to reduce the count.
2. Wait for reconnect: the pause before retry is 30 seconds to 5 minutes.
3. Add new objects after the count drops below the limit.

## If access was revoked

If the owner changes your role while you work, the server closes the connection. The room stays on screen but becomes read-only, with an "Access changed" message. Save what you need before the change or ask for access again.

## What to check

- The indicator in the header next to the help button.
- After an edit it shows **Saving**, then **Saved**.
- Offline, the N counter grows with each edit.
- After a page reload, saved edits are still there.
- After a speed or limit close, the connection returns by itself; the status changes to **Saving**, then **Saved**.
- In a full room a small edit saves, while a large paste does not.
- After deleting extra content, new objects can be added again.

## Limits

- Offline edits and edits waiting for reconnect live in the current tab. If the tab is closed before saving, unsent work is lost.
- The queue limit protects against unbounded growth; it is not a promise of unlimited offline work.
- The size limit and the object limit are set by the server. They do not delete data: the room stays readable and can be cleaned up.
