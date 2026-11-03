## Result

The header shows one of three states: **Saved**, **Saving** or **Offline (N)**.

- **Saved** — the server confirmed that the edits are stored. It does not mean "stored in the browser": confirmation arrives over the socket after the server persists them.
- **Saving** — an edit was sent but is not acknowledged yet. This is usually under a second.
- **Offline (N)** — there is no connection; N edits are waiting. They stay in this tab and are sent after reconnect.

## Offline

1. If the connection drops, keep working: edits stay in the document.
2. When the connection returns, the status changes to **Saving**, then **Saved**.
3. Wait for **saved** before closing the tab.

If too many edits accumulate, input stops: the indicator shows **Offline · input paused**, and a message appears above the board. This protects the queue from growing without bound. Reconnect and wait for **Saved** to continue.

## If access was revoked

If the owner changes your role while you work, the server closes the connection. The board stays on screen but becomes read-only, with an "Access changed" message. Save what you need before the change or ask for access again.

## What to check

- The indicator in the header next to the help button.
- After an edit it shows **Saving**, then **Saved**.
- Offline, the N counter grows with each edit.
- After a page reload, saved edits are still there.

## Limits

- Offline edits live in the current tab. If the tab is closed before reconnect, unsent edits are lost.
- The queue limit protects against unbounded growth; it is not a promise of unlimited offline work.
