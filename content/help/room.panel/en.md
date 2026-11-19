## Result

The **Properties** panel on the right describes one subject: whatever is selected, or the room itself when nothing is. Open it with **Properties** in the header and fold it away with the cross when you want the whole screen for the canvas.

## What the panel shows

| Selected | In the panel |
|---|---|
| Nothing | the room's name, **In the room** — how many objects of each type — and the **Card filter** |
| A kanban | the selection actions and **Kanban state**: columns, swimlanes and WIP limits |
| A section, a card or another object | the selection actions and that object's fields |

Selection actions are icons with tooltips; the rare ones are under **⋯ More actions**. Rare groups fold to a row with their value and a chevron: **Name and link**, **Tags**. The object ID is in **⋯ → Info**.

## Shadow

A kanban, a section and a shape can be lifted off the board: **⋯ More actions → Shadow → None, Raised, Floating**; the current level is checked. There is one shadow per level; its colour and size are shared by the whole room and follow the theme. With several such objects selected, the choice gives them all one level, and one undo puts the previous ones back.

There are no **Shadow** items when the selection holds a sticky note or a card: they have their own paper shadow.

## Check

- Clear the selection: the panel shows the room's name and counts.
- Select a kanban: the panel shows its columns and limits, and no room counts.
- Select a shape and choose **⋯ → Shadow → Floating**: a soft shadow appears under the shape, and the next time the menu opens **Floating** is checked.

## Limits

- Replacing the room with a template is in the room menu (the arrow by its name), not in the panel.
- The card filter shows only with nothing selected: after **Select cards** the found cards are selected, and the panel shows them.
