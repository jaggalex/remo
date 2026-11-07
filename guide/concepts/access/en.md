## The main rule

A person can have different roles in different rooms. For example, they might edit materials in their project room and only view another team’s room. The role applies throughout the room, including its sticky notes, cards and other objects.

## Hierarchy

```
Organisation
└── Team
    └── Room  ← the role is granted here
```

The organisation sets policy: whether members may share rooms, whether public links are allowed. Every account has a **personal organisation** (the **Personal** badge); shared organisations are an additional context for work or a club. A team is a way to grant a role to a group of people at once. The room is where the role takes effect.

At the organisation level, `org_admin`, `user_admin` and `security_admin` manage people, teams and policy; they do not replace a room role.

## Where the role comes from

A role can come from several sources: directly to a person, through a team, through the organisation. If there are several sources, the **strongest** role applies. Revoking one source does not revoke access while another one works.

## Grant and role

A **grant** is the act of giving a role: to a person, a team or the whole organisation. On screen you see a list of people with roles — those are the grants.

## What a role gives

A role is a set of capabilities: `board.read`, `board.comment`, `board.edit`, `board.share`, `board.export`, `board.backup`, `board.facilitate`, `board.manage`, `board.transfer`, `board.delete`. Comments are server records, so `commenter` writes the discussion without gaining the right to change the room. The exact table is in [/guide/reference/roles](/guide/reference/roles).

## A room without an owner

A room without an owner is closed. Its page refuses, the room is not in the room list, and the connection does not open: the content is neither visible nor editable.

Recovery is a claim. A signed-in person with the link presses **Claim this room**: the room gets an owner, joins their organisation and team, and loses the archive mark if it had one. After that, roles and the public link decide access. A claim needs an account with an organisation and a team. It happens once: after that, the owner changes only by transferring ownership.

When the version is upgraded, existing rooms without an owner do not open: the installation operator archives them. If the owner is known, the operator can assign them. Without a claim or an assignment the room stays closed; there is no automatic deletion.

## Public link

A link is not a role and not a grant: it is a property of the room. It gives **view only** and never gives export or backup. A room without an owner is not opened by a link: the link shows the claim screen, not the content. A password and an expiry are additional restrictions: changing the password closes all open browsers at once.

## Revocation and consequences

After access is revoked, an open tab switches to read-only: the room stays on screen, but edits are not accepted. No reload is needed.

:::warning
Revoking access does not undo edits already made: the tab stops accepting new ones, but what was saved stays in the room.
:::

## What is visible from outside

A person without access to a room that has an owner receives "resource unavailable" without the room name: the existence of the room is not disclosed. A room without an owner is the exception: the page says there is no owner, because the link is the only way to claim it.

## Where to go next

[/guide/capabilities/access](/guide/capabilities/access) — what access management gives.
