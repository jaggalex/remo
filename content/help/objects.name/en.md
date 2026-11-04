## Result

An object has an optional **Name** for search and presentation and a permanent **ID** for links and commands. The name is not painted on the canvas; the ID never changes.

## Steps

1. Select an object on the board.
2. In the inspector, fill in **Name** and press Enter or click outside the field. An empty value removes the name.
3. The **ID** beside it is read-only. Click **Copy ID** to paste it into a link, a command or a bug report.

## Check

- The name appears in the presentation object list and is found by search.
- The name did not appear on the canvas and did not change the object's text.
- The ID stayed the same after renaming and reloading.

## Limits

- A name does not have to be unique: two objects may share one.
- An ID cannot be changed; it is the object's stable identity.
- An empty name means "no name"; the presentation label falls back to the title, text or ID.
