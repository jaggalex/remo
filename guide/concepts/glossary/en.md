## Why a glossary

One term, one concept. If a word in the documentation differs from the word on screen, the documentation is corrected: the user looks for what they see.

## Objects and the room

| Term | Meaning |
|---|---|
| **Room** | a document with objects and the unit of access. Code and the API keep the historical name `board` |
| **Object** | a room element: sticky note, shape, text, frame, kanban, card, connector |
| **Sticky note** | an object with text, moves freely |
| **Shape** | a rectangle, ellipse or diamond; contains text |
| **Frame** | a container: objects inside move together with it |
| **Kanban** | a grid of columns and swimlanes |
| **Card** | an object inside a kanban cell; lives in the cell, not on the canvas |
| **Column**, **swimlane** | the vertical and horizontal coordinate of a cell |
| **Connector** | a line between two objects |
| **Anchor** | a point at the middle of an object's side where a connector starts; an object has four |
| **Connector routing** | the shape of a line: straight, elbow, curved |
| **Palette** | the room's one palette: seven tones at three levels plus named colours; one place where a colour is changed |
| **Tone**, **level** | the column and row of the palette: 100 and 300 for fills, 600 for lines, borders and text |
| **Named colour** | White, Black, Transparent or None: a value by name, not a tone level |
| **Custom colour** | a value outside the palette; kept until another one is chosen |
| **Rail** | the vertical toolbar on the left: create an object, undo, redo |
| **Header** | the top strip of the room: name, menus, properties, presentation, discussion, access |
| **Selection** | a temporary set of objects; not stored in the room |
| **Camera** | the position and scale of the view of the room |
| **Card status** | work state: to do, in progress, done; does not replace the column |
| **Assignee** | one person assigned to a card |
| **Date range** | start and end; overdue is derived from the local date |
| **Tag** | an element of the room vocabulary; an object stores a reference |
| **Object link** | one field: an external URL or another object in this room |

## People and access

| Term | Meaning |
|---|---|
| **Organisation** | the top level: people, teams, policy |
| **Personal organisation** | the organisation every account has, marked with the **Personal** badge |
| **Handle** | the unique `@handle` beside the name; shown in the account menu, presence and comments |
| **Object name** | an optional label of up to 120 characters for search and presentation; not painted on the canvas |
| **Object ID** | the permanent identifier; read-only and copyable |
| **Room tile** | a card on the organisation home: emoji, title, team, author and dates |
| **Trash** | the room archive; a trashed room does not open and the owner can restore it |
| **Team** | a group inside the organisation; roles can be granted to a team |
| **Role** | what a person can do in the room: **Viewer**, **Commenter**, **Editor**, **Co-owner**, **Owner** |
| **Capability** | an atomic right of a role: `board.edit`, `board.export` and others |
| **Grant** | the assignment of a role to a person, a team or the organisation |
| **Public link** | a room property: read-only access, without an account |
| **Guest** | an external participant with access to a specific room |
| **Comment** | a message in a server thread anchored to an object or a point |
| **Thread** | a root and flat replies; resolve closes it, a reply opens it again |
| **Pin** | a canvas marker showing where a thread belongs |
| **Lock** | protection of an object from edits; records its author |
| **Lock author** | the person who locked it; they or a room manager release it |
| **Reaction** | a live emoji burst near the cursor; not stored or counted |
| **Presentation** | a mode that shows room objects in order; any object can be a slide |
| **Presenter**, **follower** | the person advancing slides and the person watching the current one |

## Saving and result

| Term | Meaning |
|---|---|
| **Confirmation** | the server has written the change; the `saved` state |
| **Offline queue** | local changes waiting for a connection |
| **Backup** | JSON with the whole room and a checksum |
| **Import** | replacing the room with the contents of a backup |

## Extensions

| Term | Meaning |
|---|---|
| **Event** | a domain fact: what, where, by whom, with which object |
| **Envelope** | the event body that goes to the webhook |
| **Webhook subscription** | one organisation endpoint that receives events |
| **Dead-letter queue (DLQ)** | events that could not be delivered after all retries |
| **Integration token** | `remo_it_…`: the owner's access, narrowed by scope |
| **Scope** | `board.read` or `board.edit` — what the token is allowed |
| **Command** | a server action in a room with permission checks and idempotency |
| **Change set** | a package of agent changes with progress and resume |
| **Plan** | a structure or a layout proposed by an agent: preview, Apply, one ⌘Z; the room does not change before it is applied |
| **Tidy up** | the command that lays a selection out in columns according to an agent's plan |
| **App** | a declarative panel in the room |
| **Manifest** | the description of an app: panel, actions, capabilities |

## Where to go next

[Product model](/guide/concepts/board) — where these terms come from.
