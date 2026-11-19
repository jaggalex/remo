## When you need it

A colleague needs access to the room, someone outside the team needs to view it without an account, and after the project access has to be closed.

## Before you start

- Permission to share the room (`board.share`): the owner and co-owner always have it, an editor has it unless the organisation policy forbids it (allowed by default).
- Only an owner or co-owner can appoint a **Co-owner**: it is a management role, and `board.share` alone is not enough.
- Only the owner or co-owner can manage the public link: an editor does not see that block in the dialog.
- A guest does not manage access, whatever their role. Only the owner or co-owner can grant access to a whole organisation or team.
- Keep an invitation link private: remo does not verify email, so if the addressee has no account yet, anyone who gets the link and registers that address can accept it.
- The colleague's address. A role applies to members of the organisation. If no account exists for that address, remo shows an invitation link; if the account exists and the person is already an organisation member, access starts immediately. Otherwise membership comes first.

## Steps: a role for a person

1. Open **Share**.
2. Enter the colleague's address.
3. Choose the role: **Viewer**, **Commenter**, **Editor**, **Co-owner**.
4. Press **Добавить** (add).

If remo gives you an invitation link, send it to the recipient. They use it to sign in or create an account with the invited email address. Clicking **Accept invitation** opens the room.

The colleague gets the selected permissions.

## Steps: a link for someone outside the team

This needs the owner or co-owner role.

1. In the same dialog, find the **Публичная ссылка** (public link) block.
2. Press **Включить** (enable).
3. Set a password and an expiry if you need them.
4. Copy the link.

Result: the link opens the room read-only; export and backup are not available.

## Steps: revoke access

1. Open **Share**.
2. Find the person in the access list and remove them.
3. To close link access, press **Выключить** (disable) in the **Публичная ссылка** block.

Result: an open tab switches to read-only on its next action; new sign-ins are refused. No reload is needed.

## Check

- A colleague with an existing account sees the room immediately after being added: there is no acceptance step. Only someone without an account accepts the invitation link.
- In a private window the link opens the room without editing tools.
- After revocation the colleague cannot change an object.

## Common mistakes

| Symptom | Cause |
|---|---|
| An editor does not see the link block | only the owner and co-owner manage the link |
| No export through the link | the link is view-only by design |
| Access "came back" after revocation | the person still has a second source of the role: a team or the organisation |
| Someone outside the organisation got no access | roles apply to members: invite them or open the link |

## Where to go next

[Roles and capabilities](/guide/reference/roles) — the exact table of what each role allows.
