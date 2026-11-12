# Architecture notes

These are the longer product specifications behind the code. They describe the intended
behaviour, the boundaries and the invariants; the numbered decisions behind them are in
[ADR.md](../../ADR.md).

| Note | What it answers |
|---|---|
| [Design system](../../spec/design-system.md) | tokens, components, canvas chrome, keyboard model, grid |
| [IAM v1](../../spec/IAM-v1.md) | organisations, teams, room roles, links, sessions, enforcement |
| [AI agents v1](../../spec/AI-agents-v1.md) | principals, tasks, budgets, skills, the plan contract |
| [AI agents architecture](../../spec/AI-agents-architecture.md) | provider keys, evidential log, change sets, MCP vs skills |
| [MCP v0](../../spec/MCP.md) | the stdio façade over rooms, skills and change sets |
| [Apps](../../spec/apps.md) | declarative first-party panels |
| [Integrations](../../spec/integrations.md) | tokens, scopes and the command boundary |
| [Webhooks](../../spec/webhooks.md) | signed delivery, retries and the dead-letter queue |
| [Metrics](../../spec/metrics.md) | typed events, no content or PII |
| [Forms](../../spec/forms.md) | dialog and form rules |
| [Canvas objects: next steps](canvas-objects-next.md) | what to adopt from Excalidraw, what stays ours, and the plan for selection resize, snapping, shape text and label wrapping |
| [Agent skills](../../spec/skills/) | the brief-to-room, cards and tidy-selection contracts |

Visual baselines live in `spec/baselines` and `spec/ds-baselines`; they are test assets,
not documentation.
