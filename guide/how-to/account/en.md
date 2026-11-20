## When you need it

You need to change your name or `@handle`, set a new password from a link, confirm your email, understand how a personal organisation differs from a shared one, rename the organisation, or tidy up teams.

## Name and handle

An account has a name for people and a unique `@handle`. The account menu, presence and comments show `Name @handle`.

1. Open the account menu — the circle with your name in the top-right corner.
2. Change **Name** (1–80 characters). It does not have to be unique.
3. Change **Handle**. It is unique, stored lower-case and shown with `@`.
4. Click **Save**.

Handle: 3–32 characters, Latin letters, digits, dot, dash and underscore; it starts and ends with a letter or digit. Parentheses, spaces and control characters are rejected; reserved handles such as `admin`, `support`, `remo`, `system`, `everyone`, `here` are taken.

A handle is not a login: you still sign in with your email. Comment history is not rewritten; an old comment keeps the handle it had when sent.

## Forgot your password

The **Forgot password?** link is in the sign-in form when the installation has mail enabled. Without it, the server administrator changes the password.

1. Click **Forgot password?** under the password field.
2. Enter your email address and click **Send the link**.
3. Wait for the same answer every time: “If an account with this address exists, we sent a letter with a link. Check the Spam folder.” The answer does not say whether the account exists.
4. Open the letter **Reset your remo password** and follow the link within 60 minutes.
5. Enter a new password and confirm. The product answers: “Password changed. Sign in with the new password.”
6. Sign in with the new password.

The link is single-use. After the change every session ends, and a notice **Your remo password was changed** goes to the address. There is no automatic sign-in. If the link has expired or was already used, request a new one.

## Confirm your email

When mail is on, registration sends the letter **Confirm your email for remo**. The address is confirmed once.

1. Open the letter and click **Confirm email**.
2. The link works for 24 hours and once; you can open it in any browser.
3. Wait for “Email confirmed”.

If the letter did not arrive, check Spam. Then open the account menu, find the **Confirm your email** row and click **Send the letter again**. At most three letters per hour. The home screen has a banner with the same button; you can hide it until the next sign-in, and there is no banner in a room.

Until the address is confirmed you can sign in and work in rooms, but you cannot invite people unless the administrator turned that requirement off. The server answers `EMAIL_NOT_VERIFIED` and offers to send the letter again.

## If mail is off

- There is no **Forgot password?** link; on a sign-in error the product says only the server administrator can reset the password.
- No confirmation letters are sent, and the address does not need confirming.
- An invitation still creates a link the owner copies and passes on by hand.

In that case the server administrator changes the password.

## Personal and shared organisation

- **Personal** is the organisation every account has; the **Personal** badge appears in the list. Work alone or with an interest group.
- **Shared** is an additional organisation for work, a club or a client.
- Permissions and rooms work the same way. A personal organisation cannot be deleted.

## Organisation and teams

1. Open the account menu → **Organisation and people**.
2. Rename the organisation with **Rename**; an organisation administrator can do this.
3. In the **Teams** block, create a team, rename it, or delete it when no room or grant refers to it.
4. Expand the team members, add a person from the organisation and choose a role: team admin or member. Remove a member in the same place.

## Check

- The account menu shows the new `Name @handle`, and it survives a reload.
- A link from a letter opens the new-password form; after the change the old password no longer works.
- After the address is confirmed the banner and the request in the account menu disappear.
- The organisation screen title shows the new name.
- The renamed team appears in the list and in the team picker when creating a room.
- The product refuses to delete a team while rooms or grants refer to it.

## Limits

- A reset link works for 60 minutes and once; a confirmation link works for 24 hours.
- At most 3 reset requests per address and 10 per IP per hour; at most 3 repeated confirmation letters per hour.
- Letters arrive in the profile language, or the browser language when the profile sets none.
- A password never arrives by mail: the letter contains only a link.
- Renaming the organisation and managing teams belongs to the organisation administrator.
- A guest sees only their own seat and not the organisation's people directory.
