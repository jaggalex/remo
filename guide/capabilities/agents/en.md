## What it gives

An agent performs a task in the room from a short description: it builds a diagram, turns a selection into cards, tidies a selection into even columns, or proposes a plan for a structure. The model runs on the server; your tab applies the finished plan in one transaction.

## When to use

- You need to turn text into a diagram quickly.
- You need to lay out selected notes as kanban cards.
- You need to turn a brief into a structure and check the result before it is written.
- You need to lay selected notes out in even columns and undo all of it with one ⌘Z.
- You need to repeat the same action on a schedule.

## How it works

An agent is a separate principal owned by a person. It has no rights of its own: a task receives the owner's access at the moment it runs.

The order: an organisation administrator enables agents, the owner or a co-owner allows them in the room, you create an agent, set a task with a description and a **budget**, and the server runs it.

A task has four ways to write:

| Skill | What it does | When it reaches the room | Undo |
|---|---|---|---|
| **[Brief to room](/guide/how-to/agent-plan)** | proposes a plan for a structure | after Apply | one ⌘Z |
| **Diagram from a description** | draws shapes and connectors | immediately | by hand: ⌘Z does not undo it |
| **Cards from a selection** | turns the selection into cards (copies or moves) | after Run job | by hand; a package can be stopped and resumed |
| **[Tidy up selection](/guide/how-to/tidy-selection)** | lays the selection out in even columns; blocks are frames | after Apply | one ⌘Z |

A plan arrives as a **preview**: it writes nothing, applying it creates the objects and connectors in one transaction, and one ⌘Z takes it all back. A plan with an object outside the allowed coordinates (±1 000 000) cannot be applied; a reply with more than 10 operations is refused as `TOO_MANY_OPERATIONS`, and a plan above 300 objects or placements as `PLAN_TOO_LARGE`; both are refused before storage, so they have no preview.

Cards arrive as a **change set** with progress; it can be stopped and resumed. A diagram is written immediately, with no preview.

Tidying moves only the selected objects: sizes, texts and lines stay as they are, and locked objects stay put with a warning. A selected frame is laid out inside itself; no nested frame appears. A kanban card in the selection does not move: its cell decides where it stands, so it stays in place with a warning while the plan applies to the remaining objects. The layout is deterministic, and the model may only name blocks — tidying works without a key, and no warning about the model appears.

The budget is mandatory: a task without a limit on actions or cost is not created. The dialog sets changes and money; tokens and time are server defaults. Without a provider key the task does not fail but stays queued; cards do not call a model.

## Example

Input: a room and a selection of eight sticky notes. Action: the task "turn the selection into cards", a budget of 40 actions. Result: eight cards, an audit record and one `board.item.created` event per card.

## What you can configure

The agent (name, state), the task budget, the skill, the schedule. Provider keys are stored in the organisation or with the person and are never returned to the interface.

## Limitations

- Agents are off by default; an organisation administrator enables them, and in a room the owner or a co-owner allows them.
- A task can be set only from an account with edit permission in the room.
- An agent cannot do more than the person on whose behalf it acts.
- A plan and a diagram call the model; without a key such tasks wait in the queue. Tidying works without a model.
- A card package produces one `board.item.created` event per card; applying a plan and a diagram leave audit records only.
- A task cannot be resumed after a failure: set it again. Only a card package can be resumed.
- One plan carries up to 10 operations, 300 objects and 100 connectors; above 200 objects the preview warns that it is close to the ceiling. Above 10 operations the reply is refused with `TOO_MANY_OPERATIONS`; above 300 objects or placements, with `PLAN_TOO_LARGE`. Tidying accepts up to 50 objects; the limit is counted after groups and a frame are expanded, and a larger set is refused before a plan is stored.
- Tidying does not move kanban cards: their cell decides where they stand. A card in the selection stays in place with a warning, and the plan applies to the remaining objects.

## Provider keys

A key is access to the provider budget, not an interface setting. Create a separate key for remo and limit it in the provider dashboard with a spending cap and an expiry date; do not use your main personal key and do not share a key with colleagues. Every person and organisation should have its own key. In remo the secret is stored encrypted in the database, shown once when saved and decrypted only while a task runs; you can revoke it at any time. Technical measures are in [Security](/guide/admin/security).

## Practical instructions

[Set a task for an agent](/guide/how-to/delegate-agent) — the common path and the four skills.

[Get a plan and apply it](/guide/how-to/agent-plan) — preview, limits and what goes to the model.

[Tidy up a selection](/guide/how-to/tidy-selection) — columns, blocks and one ⌘Z.

[Connect an integration](/guide/how-to/connect-integration) — how to collect agent activity through events.

## Related capabilities

[Principal and budget](/guide/concepts/agents), [delegate a task](/guide/how-to/delegate-agent), [access](/guide/capabilities/access), [events](/guide/capabilities/events).
