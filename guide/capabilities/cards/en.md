## What it gives

A card is a record of work, not just text in a cell. It carries a status, one assignee, a
start-to-due range, tags and a link to a source or another object. A kanban column remains
the card's place and does not rewrite its status.

## When to use it

- You need to see what is being done, by whom and by when.
- You need a board vocabulary of themes and selection by tag.
- You need to go from an object to an external document or another board object.

## How it works

**Card fields** are edited on the **Properties** panel: status (to do / in progress / done), an assignee
from the board people, a start and a due date. The card shows status, name and date range; an
overdue date is marked with `!` and colour. Moving between columns changes the place, not the
status.

**Tags** are a board vocabulary: name, colour, rename and delete do not create duplicates. An
object can carry up to ten tags; **Select (N)** selects everything with that tag.

**The card filter** on the **Properties** panel selects cards by assignee and due state: overdue or no due date. It is a selection, not a hidden state: the other cards stay on the board.

**A link** is one field: an external `http(s)://` or `mailto:` URL, or another object on this board. A link
grants no board access and does not replace a role.

## Example

Input: a card "Prepare the release" in the "In progress" column. Action: set an assignee and a
due date, add the `release` tag, link a document. Result: the card shows status, assignee and
dates; the tag selects it together with the other release cards.

## Limits

- Status and column are independent. A filter by assignee or due date selects cards but does not hide the others.
- One assignee; several assignees are not in v1.
- Up to 10 tags per object, up to 50 in the board vocabulary; a tag name is up to 32 characters.
- The assignee's email is not shown on the card.
- An external link opens in a new tab; `javascript:` and `data:` are rejected.

## Practical instructions

[Card fields](/guide/how-to/card-fields) — step by step. [Tags and links](/guide/how-to/tags-links) — vocabulary and navigation.

## Related capabilities

[Frames and kanban](/guide/capabilities/frames-kanban), [canvas](/guide/capabilities/canvas), [access](/guide/capabilities/access).
