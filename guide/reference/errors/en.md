## How to read a code

A message always has two parts: what happened and what to do. The code is the machine name of the same situation.

## Example response

```json
{ "error": "SCOPE_REQUIRED", "message": "this token does not carry board.edit" }
```

The body is always the same shape: a machine-readable `error` and a human `message`. The
message says what is wrong without leaking secrets or room text.

## What to do with a code

| Response | Action |
|---|---|
| `401` | refresh the session or the token; repeating as-is will not help |
| `403` | obtain the permission or scope; a retry will not help |
| `404` | check the identifier and your access to the room |
| `409 STALE` | re-read the room, update `ifVersion`, retry |
| `409 JOB_NOT_FOUND` | start the export job again |
| `422` | fix the input; the field is named in the message |
| `503 NOT_PERSISTED` | retry with the same `Idempotency-Key` |

## Access

| Code | Status | Meaning | Action |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 | there is no session | sign in |
| `ACCOUNT_REQUIRED` | 403 | there is no account, and the action requires permissions | sign in or use an integration token |
| `FORBIDDEN` | 403 | the role does not give the required permission | request the role from the room owner |
| `RESOURCE_NOT_AVAILABLE` | 404 | the room does not exist or is not visible | check the link and access |
| `SCOPE_REQUIRED` | 403 | the integration token has no required scope | issue a token with the required scope |
| `INTEGRATION_TOKEN_UNKNOWN` | 401 | the token does not exist | check the token value |
| `INTEGRATION_TOKEN_REVOKED` | 401 | the token is revoked | issue a new one |
| `INTEGRATION_TOKEN_EXPIRED` | 401 | the token has expired | issue a new one |
| `PASSWORD_REQUIRED` | 401 | the link has a password | enter the password |
| `LINK_INACTIVE` | 404 | the link is disabled or has expired | enable the link or request a new one |
| `ALREADY_CLAIMED` | 409 | the room already has an owner | work through the owner |
| `EMAIL_MISMATCH` | 422 | the invitation is for another email | sign in with the invited account |
| `BACKUP_REQUIRED` | 403 | replacing the discussion needs the backup grant | request `board.backup` |

## Commands and writes

| Code | Status | Meaning | Action |
|---|---|---|---|
| `BAD_INPUT` | 422 | the input failed validation | fix the field named in the message |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `Idempotency-Key` is missing | send the header |
| `STALE` | 409 | the room changed since the version was read | re-read and retry |
| `NOT_PERSISTED` | 503 | the change is in memory but not written | retry with the same key |
| `OBJECT_NOT_FOUND` | 404 | the object does not exist | re-read the room |
| `CONNECTOR_EXISTS` | 409 | the pair already has a connector | change the existing one |
| `SELF_LOOP` | 422 | an object is connected to itself | choose another end |
| `OBJECT_LOCKED` | 409 | the object is locked | the author or a manager releases it |
| `LOCKED_BY_OTHER` | 409 | the lock belongs to somebody else | ask the author or a manager to release it |
| `COMMENT_FORBIDDEN` | 403 | the role cannot write in the discussion | request `board.comment` |
| `COMMENT_BODY_REQUIRED` | 422 | the comment is empty or too long | enter 1 to 4000 characters |
| `COMMENT_ANCHOR_REQUIRED` | 422 | the thread has no object or point | select an object or a place on the room |
| `THREAD_NOT_FOUND` | 404 | the thread is missing or on another room | reload the list |
| `COMMENT_NOT_FOUND` | 404 | the message is missing | reload the thread |

## Profile, organisation and room

| Code | Status | What it means | What to do |
|---|---|---|---|
| `HANDLE_TAKEN` | 409 | the handle is taken | choose another |
| `BAD_HANDLE` | 422 | the handle breaks the rules | 3–32 characters, Latin letters, digits, `.`, `-`, `_`; start and end with a letter or digit |
| `HANDLE_TOO_SHORT` / `HANDLE_TOO_LONG` | 422 | the handle is outside 3–32 | fix the length |
| `HANDLE_RESERVED` | 422 | a reserved handle | choose another |
| `NAME_REQUIRED` / `NAME_TOO_LONG` | 422 | the name is empty or longer than 80 | enter a name of 1–80 characters |
| `ICON_TOO_LONG` / `BAD_ICON` | 422 | the emoji is too long or contains control characters | choose one emoji |
| `EMAIL_TAKEN` | 409 | the email is already registered | sign in or recover access |
| `WEAK_PASSWORD` | 422 | the password is shorter than 10 characters | choose a longer password |
| `RATE_LIMITED` | 429 | too many attempts | wait and retry |
| `ORG_NAME_REQUIRED` | 422 | the organisation has no name | enter a name |
| `TEAM_NAME_REQUIRED` / `TEAM_NAME_TAKEN` | 422/409 | the team name is empty or taken | choose another name |
| `TEAM_IN_USE` | 409 | rooms or grants refer to the team | reassign them first |
| `TEAM_REQUIRED` | 409 | the organisation has no team | create a team |
| `ALREADY_ARCHIVED` / `NOT_ARCHIVED` | 409 | the room is already in the trash or already out of it | re-read the state |
| `BOARD_CREATE_FORBIDDEN` | 403 | the role cannot create rooms | ask for active organisation membership |

## Export

| Code | Status | Meaning | Action |
|---|---|---|---|
| `BAD_SCOPE` | 422 | unknown scope | select `selection`, `frame` or `board` |
| `BAD_FORMAT` | 422 | unknown job format | select `png` or `pdf`; a backup is a separate request |
| `JOB_NOT_FOUND` | 409 | the export job has expired | start the export again |

## Where to go next

[Export and backup](/guide/capabilities/export) — what export and backup require.
