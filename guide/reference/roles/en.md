## Roles

| Role | What it can do |
|---|---|
| **Viewer** | read the room, export a visible image |
| **Commenter** | read the room and write in the discussion; cannot change objects |
| **Editor** | change content, comment, share (if policy allows), export, take a backup, facilitate |
| **Co-owner** | everything **Editor** can, plus manage the room and appoint co-owners |
| **Owner** | everything, including transferring ownership and deleting |

## Organisation roles

| Role | Can do |
|---|---|
| Organisation administrator (`org_admin`) | people, teams, invitations, organisation settings, agents and policy |
| User administrator (`user_admin`) | the people list, invitations and member roles |
| Security administrator (`security_admin`) | the audit log and security policy |

An organisation role does not replace a room role: access to content is still granted on the room.

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

A **guest** works on a room within the granted role, but never has `board.share`,
`board.manage`, `board.transfer` or `board.delete`, and cannot be a co-owner.

**Copying a room and importing a backup** need `board.manage`. Only an owner or co-owner
can also grant access to a whole team or organisation.

**Co-owner is a management role.** Appointing, promoting, demoting or removing a co-owner
requires `board.manage`. `board.share` is not enough, even when a person grants the role to
themselves.

## Sources of a role

| Source | How it appears |
|---|---|
| Direct grant | the role is granted to a person on the room |
| Team | the person is in a team, the role is granted to the team |
| Organisation | the role is granted to the whole organisation; a guest does not inherit it |
| Public link | a room property; grants `board.read` only |

When several sources apply, the strongest role wins.

## How a link differs from a role

| | Public link | Role on the room |
|---|---|---|
| Account needed | no | yes |
| What it grants | read only | the capabilities of the role |
| Comments | unavailable | with `board.comment` |
| Export | forbidden | per role (`board.export`) |
| Backup | forbidden | per role (`board.backup`) |
| Password and expiry | yes | no |

## Where to go next

[Access: organisation, team, room, role](/guide/concepts/access) — why the model is built this way.
