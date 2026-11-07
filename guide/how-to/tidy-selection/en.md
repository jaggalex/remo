## What you get

The selected objects stand in even columns, and free groups get labelled block frames when the layout creates them. Sizes, texts and connectors stay as they are; one ⌘Z restores the previous positions and removes the blocks it created.

## When you need it

The sticky notes are written but scattered: stories `US-1`…`US-12`, ideas by theme, or rows of a table. You need readable columns without dragging every object by hand.

## Before you start

- You have edit permission in the room.
- Agents are enabled in the organisation and in the room, and you have at least one active agent. Tidying is an agent task even when no model is called.
- The set being laid out holds at most 50 objects. The limit is counted after expansion: a selected group brings all its members, and a selected frame brings all its contents. A larger set is refused before a plan is stored.
- Something in the selection can move: the objects are free on the canvas or sit inside a selected frame.

## Steps

1. Select objects in the room. Result: the selection bar shows their count and types.
2. Open the command in one of two ways: right-click → **Tidy up**, or the **Tidy up** button on the selection bar. A viewer has no such command, and with an empty selection it is unavailable.
3. Choose a layout. **Auto** is selected by default; you can change it later in the preview.
4. Click **Tidy up**. Result: the agent prepares a plan and the button reads "Preparing the layout…".
5. Wait for the "Before and after" preview. Result: you can see where each object will move, which blocks will appear and what stays in place; the room has not changed yet.
6. Read the warnings. If the layout does not fit, choose another one in the preview: the coordinates are recomputed and the block labels are kept.
7. Click **Apply**. Result: the objects have moved, the block frames exist, and the dialog shows "One ⌘Z puts all objects back".

## Layouts

| Layout | What it does |
|---|---|
| **Auto** | If a noticeable part of the texts carries a prefix (`US-1`, `API-2`), lays them out by prefix; otherwise by object type. |
| **By prefix** | One block per prefix. An object without a prefix joins a block of its own type and is not lost. Inside a block the natural order applies: `US-2` comes before `US-10`. |
| **By type** | One block per type: sticky notes, text, shapes. |
| **Grid** | An even grid with no block frames. |
| **By meaning** | The model proposes block labels; the engine computes the coordinates. Without a model, or when the reply is unusable, the fallback layout by prefix and type is used with a warning. |

A selected frame is laid out inside itself: its contents stand in columns, the frame itself stays in place, and no nested frame appears.

## What the preview shows

- A "Before and after" map: frame outlines, objects by kind and the planned blocks.
- The number of objects that move, the number of new blocks and the number of actions.
- Block labels, when the layout creates blocks.
- Warnings: locked objects stayed in place; objects from an unselected frame did not move; a block consists only of locked objects; the selection does not fit inside the frame; there is no free space beside it; the model was unavailable and the fallback layout was used.

## What goes to the model

Only the selection text: object ids, types and texts, at most 50 objects and 20 000 characters. Coordinates, room titles, comments and people are not sent. The model may return only block labels and a layout choice; the engine always computes the coordinates.

Tidying works without a provider key: the layout is deterministic, and no warning about the model appears. A warning appears only when the model is configured but did not answer or returned an unusable reply.

## Check the result

- The objects stand in even columns, and free groups are covered by labelled frames when the layout creates them.
- Sizes, texts and connectors are unchanged: a line still joins the same objects.
- Locked objects and objects from unselected frames did not move.
- One ⌘Z restores the previous coordinates and removes the created blocks.

## Limitations

- The 50-object limit is counted after groups and a selected frame are expanded: what matters is how many objects are laid out, not how many were selected. A larger set is refused before a plan is stored; it is never a partial layout.
- Only selected objects move. Locked objects and objects from unselected frames stay where they are.
- A kanban card does not move: its cell decides where it stands. When a card is in the selection it stays in place, the preview warns about it, and the plan applies to the remaining objects.
- A frame is not stretched around its contents. If the objects do not fit, enlarge the frame or select fewer objects.
- Blocks are frames, never groups.
- An applied plan cannot be laid out again: the layout is part of what you approved.

## Common mistakes

| Symptom | Cause |
|---|---|
| No Tidy up command | a viewer has no such command; with an empty selection it is unavailable |
| "Create an agent first" | you have no active agent; create one in Organisation → Agents |
| "AI agents are off in this room" | an organisation administrator or the room owner turned agents off |
| "Tidying works on at most 50 objects" | the selection is above the limit; select fewer |
| "The selection does not fit inside the frame" | the objects do not fit at their current size; enlarge the frame or select fewer |
| "There is no free space beside the selection" | objects outside the selection are in the way; move them and try again |
| A kanban card stayed in place | a card lives in its cell; that is expected — the plan applied to the remaining objects |
| The task failed | read the reason in Recent tasks and set the task again |

## Where to go next

[Get a plan from an agent](/guide/how-to/agent-plan) — the same path for a structure rather than for order.

[Agents: principal and budget](/guide/concepts/agents) — why a task works exactly this way.
