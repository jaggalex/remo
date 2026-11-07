## What you get

A working room with sticky notes and a connector, shared with a colleague, with saving confirmed by the server.

## Before you start

- You need an account to claim the room. A room without an owner is closed: the page says so, the room is not in the room list, and a public link shows only the claim screen, not the content.
- If `demo` already has an owner and you cannot edit it, create your own room: [Create a room](/guide/how-to/create-board).
- A room opens at `/?room=<id>`. Without `room`, the organisation home opens (`?org=<slug>`), not a hidden `board-main` room.

## Steps

1. Open `/?room=demo` and sign in. If the room has no owner, press **Claim this room**. Result: the room is claimed by you, belongs to your organisation and team, and the tools appear in the header and on the rail.
2. Press **Sticky note** on the tool rail three times (or `N`). Result: three sticky notes on the canvas.
3. Select the first sticky note with a single click, then drag from its edge to the second. Result: a connector anchored at both ends. Anchors are visible only on the selected object — without a selection the same gesture moves the sticky note.
4. Open the room menu (the room’s name) in the header and choose **Rename**. Result: everyone who has the room open sees the new name.
5. Press **Share**, enable **Public link** and copy it. Result: the dialog warns that the link is read-only.
6. Open the link in a private window. Result: the room is visible, the editing tools are not.

## Check

The indicator in the header shows **Сохранено** (the code calls this state `saved`). If it shows **Сохраняется** (`pending`), the changes are not yet confirmed by the server; if it shows **Офлайн (N)**, the connection is gone and the queue is waiting.

After a claim, the message that the room has no owner disappears and the room appears in your organisation's room list.

## What to keep in mind

- The first save may take a second: confirmation arrives after the server writes.
- A public link does not grant export: that is a separate room permission.
- A claim clears the archive mark: if the room was archived, it becomes available again after the claim.
- You can undo and redo until you reload the page. The undo history lives in the tab and starts fresh after a reload.
- The theme switches in the account menu: **System**, **Light** or **Dark**. The choice is remembered and applies to help as well.

## Where to go next

[The room screen](/guide/concepts/board-chrome) — where the header, rail, bottom and menus are.

[Create a room](/guide/how-to/create-board) — if you do not have one yet.

[First complete scenario](/guide/start/first-scenario) — the same path, taken to a finished result.
