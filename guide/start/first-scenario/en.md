## What you get

A planning room you can show to the team and restore from a file: a kanban with cards, connectors between sticky notes, and a backup.

## Before you start

- The room from the quick start, or a new one.
- Edit permission on the room.
- An organisation with at least one colleague to check access.

## Steps

1. Add a kanban template: open **More ▾ → Templates…** and choose **Kanban room**. Result: a kanban with columns and swimlanes appears. There is no separate "kanban" button — the kanban arrives as a template.
2. Double-click a cell in the first column — a card appears. Double-click the card and type a title. Result: a card with text. The template's first cells already contain blank cards: double-clicking such a card opens it for editing. A sticky note dragged into the kanban does not become a card — it stays a sticky note above the grid.
3. Add two sticky notes with **Sticky note** on the rail (key `N`), select one of them and drag from its edge to the other. Result: a connector between the sticky notes. A kanban card can be a connector endpoint too: the line follows its cell.
4. Press **Share**, enter a colleague's address, choose the **Editor** role and press **Add**. If no account exists for that address yet, remo shows an invitation link — pass it on. Result: the colleague sees the room and can change it.
5. Open the room name menu → **Export…**, choose **Room backup** in the **Format** block and save the file. The scope is disabled: a backup always covers the whole room. Result: a JSON file with a checksum and every object.

## Check

- The colleague sees edits within a second — that is live synchronisation, not a reload.
- The backup opens as JSON and contains objects, connectors and text.
- The save indicator shows **сохранено** after every step.

## What to keep in mind

- A card lives in a kanban cell and does not move across the free canvas: that is its model, not an interface limitation.
- A template is added as a copy: existing objects are untouched.
- Importing a backup replaces the whole room. It is irreversible, so do it deliberately.

## Where to go next

[Access: organisation, team, room, role](/guide/concepts/access) — why a role is granted on the room and how to revoke it.
