## Result

You get a file that can restore the board, and you can restore a board from such a file. A backup always contains the whole board, regardless of the selection.

## What is inside

- `manifest` — format, version, date, object count and checksum.
- `widgets` — board objects: notes, cards, shapes, frames, connectors, kanbans.
- `texts` and `textDeltas` — text and formatting.
- `kanbans` — columns, swimlanes and card placements.
- `groupNames`, `tags`, `presentation` — group names, the tag vocabulary and presentation order.
- `comments` — threads and messages; author names are kept, the account link is not.
- `assets` — attachments; the list is empty in v1 because images are not stored in the document yet.

It is plain JSON: you can read, verify and keep it without remo.

## Download a backup

1. Open the board menu (the board’s name) and choose Export….
2. Choose the Board backup format.
3. Click Export.

You need the `board.backup` grant; editors, co-owners and owners have it. Every download is recorded in the audit log.

## Restore a board

1. Open the board menu → Restore from backup…: the dialog opens on the restore section, with the file picker.
2. Choose a file. remo checks the format, version and checksum.
3. Check the file name and object count, then confirm the replacement.

Import replaces the whole board content, not adds objects, and replaces the discussion: an empty comment list clears the threads. An object lock is restored with the object. The action cannot be undone for everyone, so back up the current board first.

## Check

- The file opens as JSON, with `manifest` and a checksum.
- After import the object count matches the dialog and the board opens for every participant.
- Comments and tags are visible in the same places after import.

## If it did not work

- **"This is not a remo board backup".** The file was made by another program, or it is not JSON.
- **"The checksum does not match".** The file is damaged or was edited; use the original backup.
- **"Made by a newer remo version".** Update remo or use a backup in a supported version.
- **No restore section.** You need both `board.edit` and `board.backup`.
