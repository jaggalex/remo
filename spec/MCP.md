# MCP façade (v0)

**Status:** implemented as a local stdio server (`scripts/mcp-server.mjs`). Remote HTTP
with OAuth is not implemented.
**Related:** `spec/AI-agents-architecture.md` §7, ADR-068.

## What it exposes

An external agent can prepare and follow **deterministic bulk work**. It cannot read
room text, run SQL, call arbitrary URLs or act outside a change set.

| Tool | What it does |
|---|---|
| `list_boards` | Rooms the agent's owner can open in the agent's organisation, with `agentsEnabled` |
| `list_skills` | Published skills |
| `create_cards_change_set` | Queue a job: selection → cards; `preview` returns an estimate and a draft |
| `create_connector_change_set` | Queue a job: join two objects with a connector (`straight`/`elbow`/`curved`) |
| `set_connector_change_set` | Change a connector's routing or replace its rigid waypoints |
| `execute_change_set` | Execute a draft |
| `get_change_set` | Status, progress, result, error |
| `cancel_change_set` | Cancel a queued or running job |
| `resume_change_set` | Resume a failed/cancelled job from the processed sources |

Selection ids come from the caller (for example, a person tells the agent which objects
to use). There is deliberately no "read the whole room" tool: content access still
requires a task the server authorises.

## Configuration

Create an agent in the organisation panel, issue a key, and point the MCP client at the
script:

```json
{
  "mcpServers": {
    "remo": {
      "command": "node",
      "args": ["/srv/remo/scripts/mcp-server.mjs"],
      "env": {
        "REMO_API_URL": "https://boards.example.com/api",
        "REMO_AGENT_TOKEN": "remo_agent_…"
      }
    }
  }
}
```

- `REMO_API_URL` is the base the browser uses (`/api` through nginx), without a
  trailing slash.
- `REMO_AGENT_TOKEN` is the secret shown once when the key is created. It is not a
  session cookie and cannot read rooms.
- The agent must be active, its owner must have an active seat, the organisation must
  allow agents and the room must allow them.

Local invocation for a smoke test:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| REMO_API_URL=http://localhost:1234 REMO_AGENT_TOKEN=… node scripts/mcp-server.mjs
```

## Security model

- Bearer token identifies one agent and its owner; every call runs `agentEffective()`
  against the owner's current access, the room switch and the organisation policy.
- The token can only see its own change sets.
- A change set is an explicit package with an estimate and a budget; execution is
  chunked and re-checks permissions before writing.
- No token passthrough to the model provider: the server holds provider keys and never
  returns them.
- The MCP process is a façade; it has no database credentials.

## Limitations of v0

- stdio only; no remote MCP/OAuth/SSE. A remote server needs audience-bound tokens,
  per-tool scopes and rate limits (OWASP MCP guidance).
- One operation type (`create_cards`). Other operations join the same contract later.
- No approval UI; preview + execute is the approval step for now.
- No room content reads. An external agent that needs to choose objects needs their ids
  from the human or another authorised source.
