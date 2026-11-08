## What it is

The room owner assigns one active agent to the room. The agent writes a first draft from your request straight into the room, and the team continues with the usual tools: editing objects, commenting and deleting what is not needed.

The first version has two scenarios: **a process map** and **a sprint or phase plan**. A third one, **a problem map from interviews**, is available too.

## Who can ask

- **The room owner** assigns their own active agent, turns it on and gives it tasks.
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
3. Write the request and choose a kind: Process map, Sprint or phase, or Problem map.
4. Check how many sources will be sent and press Create draft.
5. Wait for Draft ready. An ordinary editable frame appears in the room; Show on canvas moves the camera to it.
6. Discuss and edit it like any other objects. A refinement in the same thread creates a new frame beside the previous one; the previous version keeps all manual edits.

## Undo

The server writes the draft, so it is not in the ordinary ⌘Z history. Right after the draft appears, **⌘Z** removes it as a whole when no newer local edit stands in front of it. If there were edits, they are undone first, then the draft. The panel has the same Undo draft button.

## Public link and ownership

While the public link is on, an agent cannot be assigned and a new task cannot be created: a new draft would be visible to guests immediately. Task history is not available through the link.

When the room changes owner, the assignment is cleared, unfinished tasks stop, and the history and already written frames remain.

## Limits

- One agent per room and one running task; further requests wait in the queue.
- Delegation to other members is out of this version: the room owner gives the task.
- A draft is new objects inside a new frame. Existing objects are not changed.
- The agent sees only explicitly selected material, the request text and the messages of this thread.
