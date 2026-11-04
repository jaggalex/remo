## The main rule

**The board is the unit of authorization.** No object has permissions of its own. Everything a person can do, they can do on a specific board — and it follows from their role on that board.

## Hierarchy

```
Organisation
└── Team
    └── Board  ← the role is granted here
```

The organisation sets policy: whether members may share boards, whether public links are allowed. Every account has a **personal organisation** (the **Personal** badge); shared organisations are an additional context for work or a club. A team is a way to grant a role to a group of people at once. The board is where the role takes effect.

At the organisation level, `org_admin`, `user_admin` and `security_admin` manage people, teams and policy; they do not replace a board role.

## Where the role comes from

A role can come from several sources: directly to a person, through a team, through the organisation. If there are several sources, the **strongest** role applies. Revoking one source does not revoke access while another one works.

## Grant and role

A **grant** is the act of giving a role: to a person, a team or the whole organisation. On screen you see a list of people with roles — those are the grants.

## What a role gives

A role is a set of capabilities: `board.read`, `board.comment`, `board.edit`, `board.share`, `board.export`, `board.backup`, `board.facilitate`, `board.manage`, `board.transfer`, `board.delete`. Comments are server records, so `commenter` writes the discussion without gaining the right to change the board. The exact table is in [/guide/reference/roles](/guide/reference/roles).

## A board without an owner

A board nobody has claimed yet follows the old rule: anyone with the link can change it. This state is temporary and exists for moving from boards without accounts. As soon as somebody presses **Закрепить доску за собой** (claim the board), the board gets an owner, and roles and the link take over.

## Public link

A link is not a role and not a grant: it is a property of the board. It gives **view only** and never gives export or backup. A password and an expiry are additional restrictions: changing the password closes all open browsers at once.

## Revocation and consequences

After access is revoked, an open tab switches to read-only: the board stays on screen, but edits are not accepted. No reload is needed.

:::warning
Revoking access does not undo edits already made: the tab stops accepting new ones, but what was saved stays on the board.
:::

## What is visible from outside

A person without access receives "resource unavailable" without the board name: the existence of the board is not disclosed.

## Where to go next

[/guide/capabilities/access](/guide/capabilities/access) — what access management gives.
