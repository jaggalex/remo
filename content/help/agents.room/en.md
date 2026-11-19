## What it is

The room owner assigns one active agent to the room. The agent writes a first draft from your request straight into the room, and the team continues with the usual tools: editing objects, commenting and deleting what is not needed.

Fifteen scenarios: **a process map**, **a sprint or phase plan**, **requirements**, **MVP**, **a retrospective**, **a decision**, **meeting actions**, **prioritisation**, **competitors**, **an architecture decision**, **ideas**, **dependencies**, **a user flow**, **a system architecture** and **a problem map** from interviews.

## Who can ask

- **The room owner** assigns their own active agent, turns it on and gives it tasks.
- **Selected editors** can give tasks. The owner selects them under Who can give tasks in the agent panel. Clearing the checkbox stops that editor’s unfinished tasks.
- **Other organisation members** with access to the room read the task history, open drafts and edit them according to their role.
- **A guest** works with objects according to their role but does not see the task history.
- **A public-link visitor** cannot run the agent: while the link is on, assignment and new tasks are closed.

## Before you start

- Agents are enabled in the organisation: Organisation → Agents.
- The owner has created an agent and assigned it to the room from the avatar in the header.
- A provider key is configured for a real draft. Without a key the task stays queued and runs once the key appears.

## Steps

1. Select the notes or cards the request is about. The selection is the agent's source.
2. Press the agent avatar in the header.
3. Write the request and choose a kind: Process map, Sprint or phase, Requirements, MVP, Retrospective, Decision, Meeting actions, Prioritisation, Competitors, Architecture decision, Ideas, Dependencies, User flow, Architecture or Problem map.
4. Check how many sources will be sent and press Create draft.
5. Wait for Draft ready. An ordinary editable frame appears in the room; Show on canvas moves the camera to it.
6. Discuss and edit it like any other objects. A refinement in the same thread creates a new frame beside the previous one; the previous version keeps all manual edits.

## Undo

The server writes the draft, so it is not in the ordinary ⌘Z history. If you gave the task in this tab, **⌘Z** after the draft appears removes it as a whole when no newer local edit stands in front of it. If there were edits, they are undone first, then the draft. The panel has the same Undo draft button. If an older draft sits outside its frame, Fit frame expands the frame to its objects.

## History

The room owner can delete one conversation or the whole agent history. Frames stay ordinary room objects, and an unfinished task in a deleted conversation is stopped. History deletion is not undone by ⌘Z; the deletion itself is recorded in the audit.

## Public link and ownership

To enable a public link, turn off the agent and confirm that visitors can see existing drafts. Task history is available to organisation members with room access.

When the room changes owner, the assignment is cleared, unfinished tasks stop, and the history and already written frames remain.

## Limits

- One agent per room and one running task; further requests wait in the queue.
- A draft is new objects inside a new frame. Existing objects are not changed.
- The agent sees only explicitly selected material, the request text and the messages of this thread. A selected frame expands to the objects inside it; when the frame is a table, the agent sees its axes and each object's cell. Comments are not part of the context.
