## What it gives

The room owner assigns one active agent to the room. The agent receives a request and writes a first working draft **straight into the room**: a separate frame with objects and connectors. From then on it is ordinary content — the team edits it, comments on it and removes what is not needed.

This differs from a plan preview: there the room does not change until Apply, while a draft exists even when the author's tab is closed.

## When to use it

- You need a business-process map quickly and want to discuss it with the team.
- You need to lay tasks out into a sprint or phase plan and see the overload.
- You need a problem map from interviews with links to the source notes.
- You need a first version for the team to improve, not a final document.

## How it works

1. **Assignment.** The owner picks their own active agent and assigns it to the room. The agent belongs to a person and has no rights of its own: a task acts for the owner and cannot exceed those rights.
2. **Request.** The owner selects the material, opens the agent avatar in the header, writes the request and chooses a kind.
3. **Draft.** The server validates the plan, finds free space and writes the frame, its objects and connectors in one transaction. Draft ready appears after the write is confirmed.
4. **Teamwork.** The frame is edited like any other. A refinement in the thread creates a new version beside the previous one; the previous version keeps manual edits.

## The two scenarios

| Kind | What the draft contains |
|---|---|
| **Process map** | Steps, decisions, labelled outcomes, the normal and the exception path, and separate questions where a condition is unknown |
| **Sprint or phase** | Mandatory and desirable scope, dependencies, risks and open questions; scope is compared only with known capacity |
| **Problem map** | Themes, observations, hypotheses and links to the source quotes |

A sprint plan is laid out deterministically: three columns, one row per task, a summary above them. The model decides what belongs where, not where to draw it.

## What goes to the model

Only what you selected, the request text and the messages of this thread. A selected frame expands to the objects inside it. The panel shows the number of sources before sending. Comments, other rooms and other tasks are not sent. Cards also carry their status, assignee and due date — without them a plan would have to invent them.

## History

The room owner can delete one conversation or the whole agent history. Frames stay ordinary room content, and unfinished tasks in a deleted conversation stop. The deletion is recorded in the audit; there is no restore in the interface. Clearing history is a deliberate action, not an undo step.

## Undo and limits

- **⌘Z** removes the latest draft as a whole when no newer local edit stands in front of it; otherwise the edits are undone first. The panel has the same Undo draft button and Fit frame, which expands an older draft frame to its objects.
- One agent per room and one running task; further requests wait in the queue.
- While the public link is on, assignment and new tasks are closed.
- When the room changes owner, the assignment is cleared, unfinished tasks stop, and the history and written frames remain.
- Delegation to other members is out of this version.

## Settings

Organisation → **Agents**: enable agents in the organisation, create an agent, disable it, configure provider keys and read the journal. The room agent panel has an Agent settings link that opens this section.

## Related

[Agents](/guide/capabilities/agents), [ask an agent](/guide/how-to/delegate-agent), [access](/guide/capabilities/access), [presentation](/guide/capabilities/presentation).
