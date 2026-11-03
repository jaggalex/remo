## Result

An organisation administrator sees which model calls happened, with what parameters and cost, and can verify that the record was not altered.

## What is recorded

- Provider, model, skill and skill version.
- Tokens, cost, latency and error code.
- The key fingerprint, never the key itself.
- A record hash linked to the previous one: the journal is a chain.

The prompt text and board content are not in the journal.

## Steps

1. Open **Organisation → Agents → Evidential journal**.
2. Filter by skill or outcome.
3. Click "Verify chain".

## What the check means

- **"Chain verified".** Every record is present and matches its hash.
- **"Chain broken at #N".** A record was changed or removed; that is a fact about the journal, not a rendering glitch. Tell the administrator.

## Limits

- Only the Organisation admin and Security admin roles see the journal; everyone else gets a refusal.
- The check is an explicit action: it recomputes hashes and never runs in the background.
