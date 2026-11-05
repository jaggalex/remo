## What you get

You set one task for an agent and know in advance what will happen to the room: a plan with a preview, a diagram at once, cards as a package, or a tidy selection.

## When you need it

You need to turn a brief into a structure, turn text into a diagram, turn a selection into cards, or even out sticky notes without doing it by hand.

## Before you start

- Agents are enabled in the organisation (by an administrator: Organisation → Agents) and on the room (by the owner or a co-owner).
- You have an active agent that you created.
- You have edit permission on the room.
- A plan or a diagram needs a provider key. Without a key the task does not fail with `AI_NOT_CONFIGURED`: it stays queued and runs once the key is configured. Cards do not call a model, and tidying works without a key.
- For cards, select the objects first. Tidying starts from a selection and does not open without one.
- The brief file is optional; if you need one, it is `.md`, `.txt` or `.csv` in UTF-8, at most 100 000 bytes.

## Steps

1. In the organisation open **Agents** and create an agent. Result: the agent is active.
2. On the room open **More ▾ → Ask AI…** and choose the agent.
3. Choose a source: the task text, a file or a selection. The **Source** block shows how many objects and characters will reach the model; **Remove** leaves the task without object text, **Selection only** makes the selection the task itself.
4. Choose a skill or **Auto**. **Brief to room** is selected by default; Auto picks a skill from the task and the selection.
5. Describe the result, attach a brief file when you need one, and set a budget: changes and money. Tokens and time are server defaults. Money may be fractional: `0.1` is ten cents.
6. Check **What will go to the model** and click **Ask the agent**.
7. Wait for the status that matches the skill and open the result.

## What will happen to the room

| Skill | What it does | Before writing | Undo |
|---|---|---|---|
| **Brief to room** | proposes a plan for a structure | a plan preview: map, objects by kind, warnings | one ⌘Z |
| **Diagram from a description** | draws shapes and connectors | no preview, written at once | by hand: ⌘Z does not undo it |
| **Cards from a selection** | turns the selection into cards | Preview job shows the card count | by hand; the package can be stopped and resumed |
| **Tidy up selection** | lays the selection out in even columns | a before-and-after preview with warnings | one ⌘Z |

A plan and a tidy apply in one transaction after **Apply**. A diagram is written at once. Cards run as a package with progress and are not undone by one ⌘Z.

In detail:

- [Get a plan from an agent](/guide/how-to/agent-plan) — sources, preview, limits and what goes to the model.
- [Tidy up a selection](/guide/how-to/tidy-selection) — layouts, a before-and-after preview and limits.

## Where to see the result

- **Recent tasks** in the agent dialog: status, task text, time and an error when there was one.
- **Plan** in Recent tasks opens the preview of an applied or pending plan. An applied plan no longer has the Apply button.
- **Card jobs** show the package progress; a stopped package is resumed from the same place.
- **Object info** names the agent and the skill that created the object.
- The **organisation journal** records the approval, rejection and application of a plan. A `board.item.created` event comes only from cards: a server command writes them, while your tab writes a plan.

## Check the result

- **Plan.** The object and connector counts in the preview match what appeared on the room; one ⌘Z returns the room to the state before the apply.
- **Diagram.** Shapes and connectors sit in the current view; Recent tasks shows the applied status; the object info names the agent and the `diagram` skill; ⌘Z removes nothing.
- **Cards.** The card count matches Preview job; the Card jobs list shows the applied status; the card info names the agent and the `cards` skill.
- **Tidy.** Objects stand in even columns, sizes and texts are unchanged, locked objects did not move; one ⌘Z restores the previous coordinates.
- **Journals.** An editor sees Recent tasks and the objects on the room. The History tab in the organisation and the Evidential journal in Organisation → Agents are visible only to the Organisation admin and Security admin roles.

## Common mistakes

| Symptom | Cause |
|---|---|
| No Ask AI… item | you are a viewer, a commenter or a public-link visitor |
| `AGENT_DENIED` | the agent is disabled, you no longer have access to the room, agents are off in the organisation or on the room, or the agent lacks write capabilities |
| `BUDGET_REQUIRED` | the task has no budget |
| No preview, the task stays queued | no provider key is configured; the task runs once the key appears |
| "The plan is not ready yet" | the task is still running; wait for the status and open the plan from the history |
| `TOO_MANY_OPERATIONS` | the reply has more than 10 operations; it is not stored — split the task |
| `PLAN_TOO_LARGE` | the plan is above 300 objects or placements; it is not stored — split the task |
| No cards are created | no objects are selected, or there are more than 500 |
| The task failed | a task cannot be resumed: read the reason and set the task again |

## Where to go next

[Get a plan from an agent](/guide/how-to/agent-plan) — the most common scenario: a structure before anything is written.

[Agents: principal and budget](/guide/concepts/agents) — why a task works exactly this way.
