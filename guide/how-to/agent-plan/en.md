## What you get

An agent proposes a structure as a plan, you see it on a map before anything is written, and you apply it in one transaction. One ⌘Z removes the whole plan: objects and connectors alike.

## When you need it

You have a description — a brief, a list of stories, a file or selected sticky notes — and no structure in the room yet. You want to see the result first and then decide whether to write it.

## Before you start

- You have edit permission in the room.
- Agents are enabled in the organisation and in the room, and you have an active agent.
- A provider key is configured. Without a key the task does not fail: it stays queued and runs once the key appears.
- A file, when you need one, is `.md`, `.txt` or `.csv` in UTF-8, at most 100 000 bytes.
- A selection, when you use one, is at most 50 objects and 20 000 characters of text.

## Steps

1. In the room open **More ▾ → Ask AI…**.
2. Choose an agent. The list shows only your active agents.
3. Choose a source. The task text is always there; a file and a selection are added to it.

| Source | What it gives | Limit |
|---|---|---|
| **Task text** | the wording of the result | 2 000 characters |
| **File** | a brief or a list of stories | 100 000 bytes; the first 20 000 characters reach the model |
| **Selection** | the texts of the selected objects as the basis of a structure | 50 objects and 20 000 characters |

The **Source** block shows how many objects and characters will reach the model. **Remove** leaves the task without object text; **Selection only** makes the selection the task itself.

4. Choose the **Brief to room** skill or **Auto**. Auto picks a skill from the task wording and the selection.
5. Describe the result and attach a file when you need one.
6. Check **What will go to the model** and set a budget: the number of changes and a dollar limit. Tokens and time are server defaults.
7. Click **Ask the agent** and wait for the plan ready status. The preview opens by itself; later you can open it with the **Plan** button in Recent tasks.
8. Read the preview and click **Apply**. Result: the objects and connectors appear in one gesture, and the dialog shows "⌘Z undoes the plan" and "Show in room".

**Reject** closes the task and writes nothing. **Show in room** closes the preview and selects nothing: applying the plan is what selects the created frames.

## What the preview shows

- The plan map: frame outlines, sticky notes, text and shapes by kind, and planned connectors.
- The object and connector count, the bounds of the plan, and objects grouped by kind with counts.
- Warnings. **Apply** is disabled only by a critical warning about coordinates: an object is outside the allowed ±1 000 000.
- Overlapping objects, an extended lane and closeness to the ceiling are warnings you may accept, not refusals.

A reply with more than 10 operations is not stored: the task fails with `TOO_MANY_OPERATIONS`. A plan above 300 objects or placements is refused as `PLAN_TOO_LARGE`. In both cases there is no preview: split the task into parts.

## What goes to the model

| What | How much | What it does not contain |
|---|---|---|
| Task wording | 2 000 characters | — |
| File | 100 000 bytes; up to 20 000 characters of text | the original file is not stored, only the extracted text |
| Selection | 50 objects and 20 000 characters | empty and repeated texts are dropped |
| Room snapshot | 200 objects | it carries only ids, types, coordinates, parents and frame and column ids; no titles, texts, comments or people |

Task text, a file and the room are data, never instructions. The model cannot change or delete existing objects, read another room, follow a link or send anything out. Its only action is to propose creating objects and connectors.

## How a plan differs from the other tasks

| Skill | Before writing | In the room | Undo |
|---|---|---|---|
| **Brief to room** | a plan preview | after **Apply**, in one transaction | one ⌘Z |
| **Diagram from a description** | no preview | immediately | by hand: ⌘Z does not undo it |
| **Cards from a selection** | the card count in Preview job | in chunks after **Run job** | by hand; the package can be stopped and resumed |
| **Tidy up selection** | a before-and-after preview | after **Apply**, in one transaction | one ⌘Z |

## Check the result

- The object and connector counts in the preview match what appeared in the room.
- One ⌘Z returns the room to the state before the apply; a second ⌘Z does not break anything.
- After applying, the dialog shows Applied and Show in room, not the Apply button.
- If the same plan is open in two tabs, the tab that applies it second gets an "already applied" answer and writes nothing.
- Applying a plan leaves organisation journal rows but creates no `board.item.created` event: your tab wrote the objects, not a server command.

## Common mistakes

| Symptom | Cause |
|---|---|
| No Ask AI… item | you are a viewer, a commenter, a public-link visitor, or you are not signed in |
| `AGENT_DENIED` | the agent is off, you lost access to the room, or agents are off in the organisation or in the room |
| `BUDGET_REQUIRED` | the task has no budget |
| No preview, the task stays queued | no provider key is configured; the task runs once the key appears |
| "The plan is not ready yet" | the task is still running; wait for the status and open the plan from the history |
| "Apply is blocked" | an object is outside the allowed coordinates; ask for a fresh plan |
| `TOO_MANY_OPERATIONS` | the reply has more than 10 operations; the plan is not stored — split the task |
| `PLAN_TOO_LARGE` | more than 300 objects or placements; the plan is not stored — split the task |
| "The room changed" | the room changed while you were reading; ask for a fresh plan |
| "The plan is already applied" | it was applied in another tab; nothing was written here |
| "The file was cut" | the first 20 000 characters reached the model; the plan itself is never cut |

## Where to go next

[Tidy up a selection](/guide/how-to/tidy-selection) — when the structure exists but the order does not.

[Agents](/guide/capabilities/agents) — all four skills and what the journal records.
