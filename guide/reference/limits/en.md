## Board and objects

| What | Value |
|---|---|
| Bends per connector | 32 |
| Connectors between one pair of objects | 1 |
| Cards per agent task | 500, processed in batches of 50 |
| Offline queue in a tab | 1000 unacknowledged changes |
| Tags per board | 50 |
| Tags per object | 10 |
| Tag name length | 32 characters |
| Comment body | 4000 characters |

## Access and links

| What | Value |
|---|---|
| Time in the bin | 90 days is shown; no automatic purge |
| Integration token lifetime | 1–365 days, 90 by default |
| Tokens per agent | 5 active |
| Link password | at least 8 characters, no upper limit; checked on the server |
| Comments | account with board access only; a link visitor does not see them |

## Agents

| What | Value |
|---|---|
| Budget in the dialog | 20 actions and 0.5 USD by default |
| Server defaults, when the request sets nothing | 8 000 tokens and 120 seconds |
| Actions, when the request sets nothing | 40 |
| Allowed budget | bounded by installation settings |
| Task description | 3–2 000 characters |
| Schedule | 60 seconds–30 days |
| Concurrent agent tasks | 1 — tasks run one at a time |
| Operations in one plan | 10 |
| Objects in one plan | 300; above 200 the preview warns |
| Connectors in one plan | 100 |
| Columns and stories in a plan | 12 columns of 50 stories; 6 swimlanes of 4 rows |
| Plan coordinates | ±1 000 000 |
| Board snapshot for the model | 200 objects |
| Selection text for a task | 50 objects and 20 000 characters; truncation is recorded on the task |
| Tidying | 50 objects after groups and frames are expanded; a larger set is refused before a plan is stored |
| Brief file | 100 000 bytes; the model sees the first 20 000 characters |
| Selection fragments for a diagram | 20 of 200 characters |

## Events

| What | Value |
|---|---|
| Delivery attempts | 8 |
| Retry ladder | 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h |
| Timeout of one request | 5 seconds |
| Signature window | 5 minutes |
| Subscriptions per organisation | 1 |

## Facilitation

| What | Value |
|---|---|
| Vote quota | 1–100, 3 by default |
| Open voting sessions per board | 1 |

## Service

| What | Value |
|---|---|
| JSON request body size | 64 KB for IAM and commands; 128 KB for export and voting |
| Export job lifetime | 1 hour |
| Session lifetime | 30 days |

## What happens at a limit

| Limit | Behaviour |
|---|---|
| Offline queue, 1000 | the tab stops accepting edits; the queue survives until the connection returns |
| 32 waypoints per connector | a new point is not added until an existing one is removed |
| 500 objects per task | the change set is refused with an explanation; the board is untouched |
| 300 objects in a plan | the plan is refused before it is stored as `PLAN_TOO_LARGE`; there is no preview |
| 10 operations in a plan | the reply is refused as `TOO_MANY_OPERATIONS`; there is no preview |
| 200 objects in a plan | a `PLAN_LARGE` warning; the plan can still be applied |
| A coordinate outside ±1 000 000 | a critical warning; the Apply button is disabled |
| Voting quota | the extra vote is refused; votes already cast stay |
| 8 webhook attempts | the event moves to the DLQ; only a manual replay remains |
| Token lifetime over 365 days | issuing is refused with `BAD_EXPIRY` |

## Where to go next

[Data formats](/guide/reference/formats) — what files and envelopes contain. [Environment settings](/guide/reference/env) — how these values change per installation.
