## What it gives

Work does not get lost when the connection drops or a write limit is reached: edits stay local and go to the server after the connection is restored or re-established. The save indicator shows what the server has confirmed.

## When to use

This is not a separate mode but a permanent property of the room. You need to understand it in three situations: when the connection drops, when access is revoked, and when a write limit is reached.

## How it works

The client numbers its changes and sends the accumulated number. The server replies with the number it has recorded. One acknowledgement covers everything up to that number. Details: [/guide/concepts/sync](/guide/concepts/sync).

## When edits do not leave at once

The server limits writes to a room. If there are too many edits in a short time, the connection closes with code `4429`. If the room has reached its limit, the connection closes with `4413`: at 20 000 objects new objects do not pass, at 64 MiB only edits up to 16 KiB pass.

In both cases nothing is lost: the edits stay in the current tab, the interface shows the reason, and the client does not reconnect at once. After `4429` the pause starts at 5 s and grows to 60 s; after `4413` it starts at 30 s and grows to 5 min. After the next connection the accumulated edits go to the server. If the room is full, delete objects to add new ones.

## Example

Input: an open room, the connection is lost. Action: move a sticky note, add a sticky note. Result: the indicator shows "offline (2)", the edits are visible to you; after the connection is restored the indicator shows "saved" and the edits are visible to others.

## What you can configure

Saving settings are not exposed in the interface: the queue limit and timeouts are part of the product behaviour. Room and write-rate limits are set per installation; the values are listed under [limits](/guide/reference/limits).

## Limitations

- The queue limit is 1000 unacknowledged changes; after it the tab stops accepting edits.
- A room holds at most 20 000 objects; after the limit new objects are refused.
- The encoded room size is 64 MiB; after it only edits up to 16 KiB pass.
- When the write rate or the room limit is exceeded, the connection closes, but no edits are lost.
- Revoking access does not roll back changes already made.
- Until the connection is restored, other participants do not see your edits.

## Practical instructions

- [Quick start](/guide/start/quickstart) — check the indicator in practice.

## Related capabilities

Collaboration, access, export.
