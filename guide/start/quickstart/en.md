## What you get

A working board with sticky notes and a connector, shared with a colleague, with saving confirmed by the server.

## Before you start

- An account is needed to claim the board. While a board has no owner, anyone with the link can change it; once it is claimed, the board opens read-only without signing in — step 6 checks this.
- A board is addressed by a name in the page address: `/?room=<name>`. Without a name, `board-main` is used.

## Steps

1. Open `/?room=demo` and sign in. If the board has no owner yet, press **Claim this board**. Result: the board belongs to you and the tools appear in the header and on the rail.
2. Press **Sticky note** on the tool rail three times (or `N`). Result: three sticky notes on the canvas.
3. Select the first sticky note with a single click, then drag from its edge to the second. Result: a connector anchored at both ends. Anchors are visible only on the selected object — without a selection the same gesture moves the sticky note.
4. Open the board menu (the board’s name) in the header and choose **Переименовать** (rename). Result: everyone who has the board open sees the new name.
5. Press **Поделиться** (share), enable **Публичная ссылка** (public link) and copy it. Result: the dialog warns that the link is read-only.
6. Open the link in a private window. Result: the board is visible, the editing tools are not.

## Check

The indicator in the header shows **Сохранено** (the code calls this state `saved`). If it shows **Сохраняется** (`pending`), the changes are not yet confirmed by the server; if it shows **Офлайн (N)**, the connection is gone and the queue is waiting.

## What to keep in mind

- The first save may take a second: confirmation arrives after the server writes.
- A public link does not grant export: that is a separate board permission.
- You can undo and redo until you reload the page. The undo history lives in the tab and starts fresh after a reload.
- The theme switches in the account menu: **System**, **Light** or **Dark**. The choice is remembered and applies to help as well.

## Where to go next

[The board screen](/guide/concepts/board-chrome) — where the header, rail, bottom and menus are.

[Create a board](/guide/how-to/create-board) — if you do not have one yet.

[First complete scenario](/guide/start/first-scenario) — the same path, taken to a finished result.
