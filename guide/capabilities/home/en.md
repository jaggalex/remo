## What it gives

The home page is one organisation's directory. Instead of an empty canvas you see board
tiles: emoji, title, team, author, creation date and update date. The same screen carries
name search, sorting and pages.

The address says where you are: `?room=<id>` opens a board, `?org=<slug>` opens the
organisation home. Switching organisation leaves the board: the previous organisation and
its board are left behind instead of becoming a filter over an open canvas.

## When to use it

- You need to switch between a personal and a work organisation.
- You need to find a board by name among many.
- You need to create a board in a specific organisation.
- You need an emoji so a board stands out in the list.

## How it works

1. **All boards** in the board header, or the organisation name, opens the home.
2. The **Organisation** field switches context. The personal organisation carries the
   **Personal** badge; every account has one, even a person working alone.
3. Search looks at the board name. Sort by updated, created, name or author; the arrow
   changes direction. Newest-updated comes first by default.
4. Tiles flow left to right, then top to bottom, 24 per page. Page numbers sit below.
5. A tile shows the team, the author `Name @handle` and the dates. Author means creator;
   handing over ownership does not rewrite it.
6. The tile menu changes the emoji, duplicates or trashes the board by permission.
7. **New board** creates a board in the chosen organisation.
8. **Trash** beside **Boards** shows deleted boards; **Restore** puts a board back in the list.

## Example

Input: a person belongs to a personal and a work organisation. Action: they open **All
boards**, choose the work organisation, sort by name and open a board. Result: the list
shows only the work organisation's boards, and the chosen board opens at `?room=…`.

## Limits

- The icon is one emoji. Images and uploaded icons need storage and come in a later step.
- Creation dates of old boards were restored from the update date and may be approximate.
- Search is by board name, not by canvas content.
- There is no "all organisations at once" mode: the directory always belongs to one
  organisation.

## Practical instructions

[Create a board](/guide/how-to/create-board) — step by step.

## Related capabilities

[Access and roles](/guide/capabilities/access), [presentation](/guide/capabilities/presentation).
