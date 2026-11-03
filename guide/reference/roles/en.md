## Roles

| Role | What it can do |
|---|---|
| **Просмотр** (viewer) | read the board, export a visible image |
| **Комментарии** (commenter) | read the board and write in the discussion; cannot change objects |
| **Редактор** (editor) | change content, comment, share (if policy allows), export, take a backup, facilitate |
| **Со-владелец** (co-owner) | everything **Редактор** can, plus manage the board and appoint co-owners |
| **Владелец** (owner) | everything, including transferring ownership and deleting |

## Capabilities

| Capability | Viewer | Commenter | Editor | Co-owner | Owner |
|---|---|---|---|---|---|
| `board.read` | yes | yes | yes | yes | yes |
| `board.comment` | — | yes | yes | yes | yes |
| `board.edit` | — | — | yes | yes | yes |
| `board.share` | — | — | yes* | yes | yes |
| `board.export` | yes | yes | yes | yes | yes |
| `board.backup` | — | — | yes | yes | yes |
| `board.facilitate` | — | — | yes | yes | yes |
| `board.manage` | — | — | — | yes | yes |
| `board.transfer` | — | — | — | — | yes |
| `board.delete` | — | — | — | — | yes |

(*) An editor can share only if the organisation policy allows it.

A **guest** works on a board within the granted role, but never has `board.share`,
`board.manage`, `board.transfer` or `board.delete`, and cannot be a co-owner.

**Copying a board and importing a backup** need `board.manage`. Only an owner or co-owner
can also grant access to a whole team or organisation.

**Co-owner is a management role.** Appointing, promoting, demoting or removing a co-owner
requires `board.manage`. `board.share` is not enough, even when a person grants the role to
themselves.

## Sources of a role

| Source | How it appears |
|---|---|
| Direct grant | the role is granted to a person on the board |
| Team | the person is in a team, the role is granted to the team |
| Organisation | the role is granted to the whole organisation; a guest does not inherit it |
| Public link | a board property; grants `board.read` only |

When several sources apply, the strongest role wins.

## How a link differs from a role

| | Public link | Role on the board |
|---|---|---|
| Account needed | no | yes |
| What it grants | read only | the capabilities of the role |
| Comments | unavailable | with `board.comment` |
| Export | forbidden | per role (`board.export`) |
| Backup | forbidden | per role (`board.backup`) |
| Password and expiry | yes | no |

## Where to go next

[Access: organisation, team, board, role](/guide/concepts/access) — why the model is built this way.
