## Result

A card keeps a status, one assignee and a date range. These fields appear on the card and are edited on the **Properties** panel; they do not replace the kanban column.

## Steps

1. Select a card on the board.
2. On the **Properties** panel, open Card fields.
3. Choose a status: To do, In progress or Done. The empty value removes the status.
4. Choose an assignee from the board's people, or leave it Unassigned.
5. Set a start and a due date. Either can be empty; the card then shows one date.
6. To clear a date, remove its value.

## Check the result

- The card shows its status, assignee name and dates.
- The values are the same after a reload.
- An overdue date is marked `!` and by colour, not colour alone.
- The save indicator shows saved.

## Limits

- Status and column are independent: moving a card to another column does not change its status.
- One assignee; multiple assignees are not in v1.
- The assignee's email is not shown on the card.
- The picker lists people with access to the board; a link visitor is not included.
- Tags are a separate board vocabulary; add them to a card in the **Tags** block (up to 10 per object).
