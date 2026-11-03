## Principal

An agent is a separate subject owned by a person. It has no password and no seat in the organisation: it does not sign in to the product, it is executed by the server for a task.

This differs from an integration token: a token acts as its owner, while an agent acts as an agent, but **within the owner's access**.

## Authority

The right to a task is the intersection of three things:

| What | Where it comes from |
|---|---|
| Owner's access | the owner's role on the board at the moment of execution |
| Organisation policy | whether agents are enabled and what is allowed |
| Skill requirements | which capabilities are needed for this skill |

If at least one condition is not met, the task is not created or stops before writing. Before writing, the check is repeated: access could have been revoked between submission and execution.

## Budget

A task without a budget is not created. The dialog sets two limits: the number of actions and the cost. Tokens and time come from the server defaults — 8 000 tokens and 120 seconds — unless the request sets them explicitly.

A budget is not a hint but a condition: once it is exhausted, the task stops.

## Paths of writing

- **Plan.** The agent proposes a structure or a layout of the selection, and the preview writes nothing. A person's tab applies the plan in one transaction, and one ⌘Z removes everything. A structure plan and a tidy are one mechanism with different skills.
- **Diagram.** The agent writes shapes and connectors immediately; there is no preview, and ⌘Z does not undo that write.
- **Change set.** Cards arrive as a package: operations, progress, the ability to stop and resume. A large diagram does not block the board for a minute — work goes in portions, and progress is kept between portions.

Without a provider key a task that needs the model does not fail; it waits in the queue. Cards do not call a model, and tidying works without a key.

## Journal

Every model call is written to the journal: who, which task, which skill, how many tokens and how much money. The journal is linked by hashes per organisation, so it can be verified: change a row and the chain will not match.

Provider keys are stored encrypted and are never returned to the interface; a fingerprint remains in the journal.

## Where to go next

[Agents](/guide/capabilities/agents) — the practical side and the limits.
