## What it gives

Tools for a meeting: a timer that everyone sees, voting on objects, and «Позвать всех к себе» (Bring everyone to me).

## When to use

- Timebox a discussion.
- Make a quick decision on a set of options.
- Gather people in one area of the room.

## How it works

The **timer** lives in the room, not in your tab: everyone sees it, and it keeps running even if you closed the panel. Start, pause, resume, +1 minute and reset are available.

**Voting** opens a session on the selected objects. Each person has a quota of votes (3 by default, 100 maximum); sessions of one account share one quota, a second browser adds no votes. By default votes are anonymous: only the aggregate is visible. After the session ends the results can be published to the room as plain text: a title, places and votes (up to 10), and the number of participants.

In an open session the results name who voted for what after it ends; in an anonymous session only sums are visible, and nobody — including the facilitator — sees the names. Guests by link are shown as a number.

**Bring everyone to me** is an invitation. When automatic following (**Follow automatically**) is on, participants' view moves at once; otherwise each person gets a "Follow / Stay" question and decides. The invitation lives in **Facilitation ▾ → Shared viewing → Bring everyone to me**.

## Example

Input: a room with four options. Action: open voting on these objects, quota 2, anonymous. Result: each person votes twice, you see the sum, then you publish the result.

## What you can configure

The timer duration, the vote quota, anonymity, the set of objects for voting.

## Limitations

- One voting session is open in a room at a time.
- Facilitation can be run by a role with the `board.facilitate` capability: editor and above.
- Votes are not revealed if the session is anonymous. In an open session names are visible only after it ends.
- A published result is ordinary text with no formatting: a title, lines like "1. … — N" and the number of participants. The snapshot has no rich styling.
- Follow and an invitation grant no rights: they only move the camera.

## Practical instructions

[Grant access and invite participants](/guide/how-to/share) — roles and the link.

## Related capabilities

[Run a meeting](/guide/how-to/run-meeting), [collaboration](/guide/capabilities/collaboration), [access](/guide/capabilities/access), [roles](/guide/reference/roles).
