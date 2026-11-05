## Product

| Limitation | What it means |
|---|---|
| No mentions or notifications | comments are read in the room; `@` and push are not in v1 |
| Comments are online only | a reply draft is kept, sending waits for the network |
| Reactions are not stored | a live burst, not a counter or a record |
| A lock is coordination, not an ACL | a raw write client can bypass the UI |
| PNG/PDF omit resolved threads and cap a thread at three messages | the full text stays in remo |
| No permissions on an object | access is granted on the room only; an object cannot be closed separately |
| One connector per pair | a second line between the same objects cannot be created |
| One open voting session | per room |
| One webhook endpoint | per organisation |
| No events about changes and deletions | only object creation, connectors and app actions |
| A token is never wider than its owner | there is no separate "organisation token" |
| Apps come only from the build | your own schema or third-party code cannot be installed |
| There is no marketplace | this is a direction, not a forgotten feature |
| Home search is title-only | there is no search across all room content |

## Synchronisation

| Limitation | What it means |
|---|---|
| The undo history lives in the tab | after a reload it starts from scratch |
| The offline queue holds 1000 changes | beyond that, input stops |
| One process | two copies behind a load balancer will not see each other's rooms |
| Merging without a "winner" | edits to different objects do not conflict; edits to one object are applied in the server's order |

## Agents and integrations

| Limitation | What it means |
|---|---|
| Comments and locks produce no domain events | events exist for object creation, connectors and app actions |
| One task at a time | a slow model delays the queue, not the canvas |
| An event is delivered at-least-once | deduplicate by `id` |
| DLQ after 8 attempts | after that, only replay |

## Documentation and reference images

| Limitation | What it means |
|---|---|
| The pixel diff between operating systems is off | the visual gate is semantic, PNG is for humans |
| In the local portal preview, `/help/…` links do not work | help lives in the app on a different port |
| The portal is static | search is client-side, without a server |

## Where to go next

[Changelog](/guide/support/changelog) — what changed and when.

[Disclaimer](/guide/support/disclaimer) — why the version has no warranty and what to do about bugs.
