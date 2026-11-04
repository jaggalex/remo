## Result

An account has a display name for people and a unique `@handle`. The account menu, presence and comments show `Name @handle`, so a person can be mentioned and told apart from a namesake.

## Before you start

- You are signed in.
- The name and handle live in the account menu, in the section with your name.

## Steps

1. Open the account menu — the circle with your name in the top-right corner.
2. Change **Name**. People see it; it does not have to be unique.
3. Change **Handle** (`@handle`). It is unique, stored lower-case and shown with `@`.
4. Click **Save**.

Handle rules: 3–32 characters, Latin letters, digits, dot, dash and underscore only; it starts and ends with a letter or digit. Parentheses, spaces and control characters are rejected. Reserved handles such as `admin`, `support`, `remo`, `system`, `everyone`, `here` are taken.

## Check

- The account menu shows the new `Name @handle`.
- The handle survives a reload and signing in from another browser.
- A comment and the presence tooltip show the same handle.

## Limits

- A handle is not a login: you still sign in with your email.
- A handle can change, but comment history is not rewritten: an old comment keeps the handle it had when sent.
- A taken handle is refused with `HANDLE_TAKEN`.
