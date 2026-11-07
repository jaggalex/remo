## Result

An agent does a task in the room on your behalf. There are four scenarios, and they change the room differently:

- **Plan** (the Brief to room skill): the agent proposes a structure, you read the preview and press Apply. The room does not change before that, and one ⌘Z removes the whole structure.
- **Diagram** (the Diagram from a description skill): the agent writes shapes and connectors immediately, with no preview; ⌘Z does not undo that write.
- **Cards** (the Cards from a selection skill): the agent builds a package from the selection. Preview job shows the card count, Run job creates them; ⌘Z does not undo the package.
- **Tidy up** (the Tidy up selection skill): the agent lays the selection out in even columns. You choose the layout in the before/after preview and press Apply; one ⌘Z puts every object back.

## Who can ask

- **An account with edit rights.** The Ask AI… item in the More ▾ menu is shown only to someone who can change the room: an editor, a co-owner or the owner.
- **A public-link visitor** gets no AI entry: a link is a view grant, and an agent needs an account to act for. Even when you are signed in, if the only access to this room is the link, AI stays closed.
- **A viewer or commenter** can watch the room but cannot ask an agent: edit rights come first.

## Before you start

- Agents are enabled in the organisation and in the room. In the organisation an administrator enables them (Organisation → Agents); in the room the owner or a co-owner does.
- You have an active agent that you created: the list shows only your enabled agents, and nobody can run somebody else's agent.
- A plan or a diagram needs a provider key. Without a key the task does not fail with `AI_NOT_CONFIGURED`: it stays queued and runs once the key is configured.
- Cards do not call a model, and tidying works without a key.
- For cards and tidying, select the objects first: without a selection these skills are not offered.
- The brief file is optional. If you attach one, it must be `.md`, `.txt` or `.csv` in UTF-8, at most 100 000 bytes.

## Provider key

A key is access to the provider budget. Create a separate key for remo with a spending cap and an expiry date; do not use your main personal key or share it. In remo the secret is stored encrypted in the database, shown once and decrypted only while a task runs; you can revoke it at any time.

## How a plan works

1. **Task.** You describe the result and attach a file when you need one.
2. **Preview.** The agent returns a plan: how many objects and connectors will appear, where they will sit, and what looks doubtful. The room does not change at this point.
3. **Apply.** You read the plan and press Apply. All objects and connectors are written in one gesture.
4. **Undo.** One ⌘Z removes the whole plan: objects and connectors alike.
5. **Opening it again.** The plan shows the result and a "Show in room" button instead of Apply. If the same plan was open in two tabs, the tab that applies it second gets the server's "already applied" answer and writes nothing; it shows no ⌘Z hint, because it wrote nothing.

## Steps

1. Open More ▾ and choose Ask AI…
2. Choose an agent and a skill. Brief to room is selected by default; the list shows only skills compatible with the task and the selection, plus Auto. Auto picks a skill from the wording of the task.
3. Check the source: the Source block shows how many objects and characters of the selection will reach the model. Remove keeps the task without object text; Selection only makes the selection the task itself.
4. Describe the task: what should exist afterwards. Brief to room also accepts a `.md`, `.txt` or `.csv` file in UTF-8.
5. Check "What will go to the model" and set a budget. The dialog sets changes and money; tokens and time are server defaults. Money may be fractional: `0.1` is ten cents, `0.25` a quarter.
6. Click "Ask the agent" and wait for the plan ready status. A preview opens: a plan map, objects grouped by kind with counts, bounds, and warnings with their codes.
7. Read the plan and press Apply. Reject closes the task and writes nothing. After applying, the dialog shows "⌘Z undoes the plan" and "Show in room".

## Diagram: straight onto the room

1. Choose the Diagram from a description skill and describe the process.
2. Click "Ask the agent" and wait for the applied status.

Result: shapes and connectors appear in the current view. There is no preview, so the future diagram cannot be checked beforehand. One ⌘Z does not undo the diagram: delete the extra objects by hand or ask for a fresh diagram. A provider key is needed, as for a plan.

## Cards: a package

1. Select the objects to turn into cards in the room: up to 500.
2. Choose the Cards from a selection skill, where the cards should go, and what to do with the source — Keep or Move.
3. Click "Preview job". Result: the card count; nothing is written to the room yet.
4. Click "Run job". Result: cards appear in chunks, and the Card jobs list shows progress.

A package can be stopped with Stop and resumed with Resume: progress is kept between chunks. This applies to a card package, not to a plan or diagram task. One ⌘Z does not undo the cards.

## Tidy up: columns

1. Select sticky notes in the room. Press Tidy up in the context menu or on the selection bar.
2. Choose a layout: Auto, By prefix, By type, Grid or By meaning. Natural order puts `US-2` before `US-10`.
3. Wait for the before/after preview: the map shows where objects move from and to, and warnings name locked objects and foreign frames that stay put.
4. Change the layout in the preview if needed: block labels are kept and coordinates are recomputed.
5. Press Apply. Sizes, texts and lines do not change; one ⌘Z puts everything back.

If a frame is selected, its contents are laid out inside it and the frame itself does not move. Blocks are frames, never groups. The 50-object limit is counted after groups and the selected frame are expanded: a larger set is refused before a plan is stored. A kanban card stays in place with a warning: its cell decides where it stands, and the plan applies to the remaining objects.

## Check the result

- **Plan.** The object and connector counts in the preview match what appeared in the room. One ⌘Z returns the room to the state before the apply. Applying selects the created frames; "Show in room" only closes the preview and selects nothing.
- **Tasks.** In the agent dialog, "Recent tasks" shows the status and the task text; the created objects are visible in the room.
- **Who sees the journals.** The History tab in the organisation and the Evidential journal in Organisation → Agents are visible only to the Organisation admin and Security admin roles. An editor sees Recent tasks and the objects in the room, not those tabs.
- **Audit and events.** Applying a plan leaves organisation journal rows ("Plan approved", "Plan applied") but no `board.item.created` event. A card package creates objects through server commands, so each card produces a `board.item.created` event for webhooks.
- **Diagram.** Shapes and connectors appear in the current view; "Recent tasks" shows the applied status; the object info names the agent and the `diagram` skill. ⌘Z does not remove the diagram.
- **Cards.** The card count matches "Preview job"; the card job shows the applied status; the card info names the agent and the `cards` skill.

## Files and limits

- Brief formats: `.md`, `.txt`, `.csv`; UTF-8 only. The file is optional.
- A file is at most 100 000 bytes; the model sees the first 20 000 characters of the extracted text, cut at a line boundary. The plan itself is never truncated.
- One plan carries up to 10 operations, 300 objects and 100 connectors; up to 12 columns, 50 stories per column, 6 swimlanes of 4 rows each. Above 200 objects the preview warns that the plan is close to the ceiling. Above 10 operations the reply is refused with `TOO_MANY_OPERATIONS`; above 300 objects or placements, with `PLAN_TOO_LARGE`. In both cases the plan is not stored.
- Plan coordinates stay within ±1 000 000. Object text is at most 2 000 characters, a title 200.
- The room snapshot describes up to 200 objects.
- The selection text for a task is at most 50 objects and 20 000 characters; the cut is recorded on the task.
- A task without a budget is not created. The dialog sets changes and money; tokens (8 000) and time (120 seconds) are server defaults unless the request sets them explicitly.
- A card package holds up to 500 objects, in chunks of 50.
- Tidying takes up to 50 objects and 20 000 characters of selection text; the limit is counted after groups and a selected frame are expanded. A larger set is refused before a plan is stored.

## What goes to the model

- The wording of the task.
- For a brief, the attached file as plain text; CSV rows become `Header: value | Header: value`. Long text is cut after 20 000 characters.
- A room snapshot of up to 200 objects: object, frame and kanban column ids, types, coordinates, sizes, parents and connector ends. Titles, sticky note text, comments and people are not sent.
- For a diagram, up to 20 short fragments of the selected objects, 200 characters each.
- For cards, no model is called.

The task, the file and the room are data, not instructions. The model cannot change or delete existing objects, read another room or follow a link.

## If it did not work

- **No Ask AI… item.** You are a viewer, a commenter, a link visitor, or not signed in.
- **"Set a limit".** A task without a budget is not created.
- **"Agents are off".** An organisation administrator or the room owner (co-owner) turned them off.
- **"The agent service is unreachable".** Sync is not running; start it and click Retry.
- **"You have no agents yet".** Open **Organisation → Agents → Create agent**, enable it, then return to the room. The list shows only active agents you created.
- **`AGENT_DENIED`.** The task did not run: the agent is disabled, you no longer have access to the room, agents are off in the organisation or in the room, or the agent lacks write capabilities. The exact reason is next to the task in "Recent tasks".
- **No key.** The task does not fail: it stays queued and runs once the key is configured. Until then no plan preview appears.
- **"Attach a .md, .txt or .csv file".** Other formats are not read. Save the text in one of them.
- **"The file does not look like UTF-8".** Save it as UTF-8 and attach it again.
- **"Larger than 100 000 bytes".** Shorten the file or attach only the part the agent needs.
- **"The file was cut".** The model saw the first 20 000 characters; the plan itself is never truncated.
- **"The plan is not ready yet".** Wait for the plan ready status and open the plan from the task history.
- **"The room changed".** It changed while you were reading; ask the agent for a fresh plan.
- **"Apply is blocked".** The plan has a critical warning: a box outside the allowed coordinates (±1 000 000). Ask the agent for a fresh plan.
- **`TOO_MANY_OPERATIONS`.** The plan has more than 10 operations. It is not stored: split the task into parts.
- **`PLAN_TOO_LARGE`.** A plan above 300 objects or placements is refused by validation and not stored: there is no preview, and the task shows the failed status. Split the task.
- **"The plan is already applied".** It was applied in another tab. Nothing was written here; the objects are already in the room. If a simultaneous click in two tabs did double the objects, press ⌘Z and ask for a fresh plan.
- **The task failed.** A task cannot be resumed: read the reason in the history and set the task again. Only a card package can be resumed, with Resume in the Card jobs list.
