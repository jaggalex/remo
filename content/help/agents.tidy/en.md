## Result

The selected objects stand in even columns, and free groups are covered by labelled block frames when the layout creates them. Sizes, texts and connectors stay as they are; one ⌘Z restores the previous positions and removes the created blocks.

## Who can

- **Start it** — an editor of the room and above.
- Agents are enabled in the organisation and in the room, and you have an active agent. Tidying is an agent task even when no model is called.
- **An editor can open the preview and apply the plan**: reading a plan requires edit permission in the room. A viewer has no Tidy up command: it is hidden.

## Before you start

- Select objects in the room: the set being laid out holds up to 50. The limit is counted after expansion: a selected group brings all its members, and a selected frame brings all its contents.
- Something in the selection must be able to move: the objects are free on the canvas or sit inside a selected frame. Locked objects and objects from unselected frames stay where they are.
- Kanban cards stay in place: their cell decides where they stand. When a card is in the selection, the plan still applies to the remaining objects, and the preview warns about the card.

## Steps

1. Select the objects.
2. Click **Tidy up** in the context menu or on the selection bar.
3. Choose a layout. **Auto** is selected by default.
4. Click **Tidy up** in the dialog. Result: the agent prepares a plan and the button reads "Preparing the layout…".
5. Wait for the preview. Result: dashed lines in the room show where objects will move and which blocks will appear; the objects have not moved yet, and a task panel sits at the bottom.
6. When needed, open Details and change the layout: the block labels are kept and the coordinates are recomputed.
7. Click **Apply**. Result: the objects have moved, the block frames exist, and one ⌘Z puts everything back.

## Layouts

| Layout | What it does |
|---|---|
| **Auto** | by prefixes when the texts carry them; otherwise by type |
| **By prefix** | one block per prefix; `US-2` comes before `US-10` |
| **By type** | one block per object type |
| **Grid** | an even grid with no block frames |
| **By meaning** | the model names blocks, the engine computes the coordinates |

A selected frame is laid out inside itself: its contents stand in columns, the frame itself does not move, and no nested frame appears.

## What goes to the model

Only the selection text: object ids, types and texts, at most 50 objects and 20 000 characters. Coordinates, room titles, comments and people are not sent. The model may return block labels and a layout choice; the engine always computes the coordinates.

Tidying works without a provider key: the layout is deterministic, and no warning about the model appears. A warning appears only when the model is configured and did not answer.

## Check the result

- The objects stand in even columns, and free groups are covered by labelled frames.
- Sizes, texts and connectors are unchanged.
- Locked objects and objects from unselected frames did not move.
- One ⌘Z restores the previous coordinates and removes the created blocks.

## Limitations

- Up to 50 objects in the set being laid out: the limit is counted after groups and frames are expanded. A larger selection is refused before a plan is stored.
- A kanban card stays in place: its cell decides where it stands. The plan applies to the rest of the selection.
- A frame is not stretched around its contents: if the objects do not fit, enlarge the frame or select fewer.
- Blocks are frames, never groups.
- An applied plan cannot be laid out again.
