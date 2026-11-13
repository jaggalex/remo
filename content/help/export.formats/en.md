## Result

You get a file with the chosen scope: a PNG for a chat or a document, or a one-page PDF with the same picture.

## Formats

- **PNG** — lossless, no transparency is needed, the background comes from the theme. Good for chat, slides and documents.
- **PDF** — the same picture on one page. Proportions are kept; text in the PDF is not editable or searchable.
- **Room backup** — a separate format for moving data, not a picture. See the Backup and restore topic. A backup keeps the table layout and each object's cell.
- **A section table** in PNG/PDF is drawn with its grid, headers and fills: it is part of the section, not screen chrome.

## Who may export

- **PNG and PDF** — the `board.export` grant. Viewers, commenters, editors and owners have it.
- **Backup** — the `board.backup` grant. Editors, co-owners and owners have it.
- **Backup import** — the `board.manage` grant. Co-owners and owners have it.
- **A public-link visitor** gets neither a picture nor a backup: a link is a view grant, not a data-egress grant.

## Steps

1. Open the room menu (the room’s name) and choose Export….
2. Choose a scope and a format.
3. Click Export and wait for "The file is ready".

## If it did not work

- **No Export entry in the room menu.** You have neither `board.export` nor `board.backup`; ask the owner for access.
- **A format is unavailable.** Your role does not have the matching grant.
- **The export failed.** The room was not changed. Retry: the request is kept, and a retry does not create a second request.
