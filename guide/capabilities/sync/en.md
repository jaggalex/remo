## What it gives

Work does not get lost when the connection drops: edits stay local and go to the server after the connection is restored. The save indicator shows what the server has confirmed.

## When to use

This is not a separate mode but a permanent property of the room. You need to understand it in two situations: when the connection drops and when access is revoked.

## How it works

The client numbers its changes and sends the accumulated number. The server replies with the number it has recorded. One acknowledgement covers everything up to that number. Details: [/guide/concepts/sync](/guide/concepts/sync).

## Example

Input: an open room, the connection is lost. Action: move a sticky note, add a sticky note. Result: the indicator shows "offline (2)", the edits are visible to you; after the connection is restored the indicator shows "saved" and the edits are visible to others.

## What you can configure

Saving settings are not exposed in the interface: the queue limit and timeouts are part of the product behaviour.

## Limitations

- The queue limit is 1000 unacknowledged changes; after it the tab stops accepting edits.
- Revoking access does not roll back changes already made.
- Until the connection is restored, other participants do not see your edits.

## Practical instructions

- [Quick start](/guide/start/quickstart) — check the indicator in practice.

## Related capabilities

Collaboration, access, export.
