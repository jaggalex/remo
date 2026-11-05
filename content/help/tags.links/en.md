## Result

Tags group objects by meaning, and a link on an object leads to a source or to another room object. Both survive a reload and are included in a backup.

## Tags

1. Select a card or a sticky note.
2. On the **Properties** panel's Tags block, enter a name, choose a colour and click Add.
3. Tick the tag under "Tags on this object". Result: the object carries the tag.
4. Click "Select (N)" on a tag. Result: the objects with that tag are selected; nothing is hidden, so the change is visible.
5. Rename the tag in its row or delete it. A rename changes the label everywhere; a delete removes it from every object.

## Links

1. Select one object.
2. In the Link block, paste an external `https://…` address and click Apply.
3. Or choose a room object in the list and click its Apply.
4. Click Open to follow the link, or Remove to clear it.

## Check

- Tags and the link are still there after a reload.
- Renaming a tag does not create a second tag.
- An external link opens in a new window; an internal one opens the object on this room.
- A `javascript:` or `data:` link is refused.

## Limits

- One tag is one room record; 50 tags per room and 10 per object.
- A link grants no access: opening an internal link still checks rights.
- An external link is not embedded or fetched by the server; it only opens.
- An internal link can only target an object on this room.
