## Main

| Variable | What it sets | Without it |
|---|---|---|
| `DATABASE_URL` | Postgres with boards, IAM and the journal | the service refuses to start if a database is set but unreachable; without the variable disk mode works |
| `PORT` | port of the sync service | 1234 |
| `REMO_DATA_DIR` | directory for disk mode | `apps/sync/.data` |

## Example

```bash
# /srv/remo/.env, mode 600, owned by the service user
DATABASE_URL=postgres://remo:<password>@127.0.0.1:5432/remo
NODE_ENV=production
PORT=1234
REMO_APP_ORIGIN=https://boards.example.com
REMO_CORS_ORIGIN=https://boards.example.com
REMO_METRICS_TOKEN=<32 random bytes>
REMO_DATA_DIR=/var/lib/remo
REMO_KEK=<openssl rand -base64 32>
REMO_KEK_ID=v1
```

## Security and keys

| Variable | What it sets |
|---|---|
| `REMO_KEK` | wrapping key for secrets: 32 bytes in base64 |
| `REMO_KEK_ID` | key version, `v1` by default |
| `REMO_APP_ORIGIN` | application address for links in emails and invitations |
| `REMO_CORS_ORIGIN` | allowed origin for the API; `*` by default |

Without `REMO_KEK` a provider key cannot be added and a webhook cannot be set up: the server answers `WEBHOOK_LOCKED` or `AI_CREDENTIALS_LOCKED`. Secrets already stored are not decrypted if the key is lost.

## Metrics

| Variable | What it sets |
|---|---|
| `REMO_METRICS_DATABASE_URL` | separate database for product metrics |
| `REMO_METRICS` | `off` disables instrumentation explicitly |
| `REMO_METRICS_TOKEN` | token for `/metrics`; required in production |

Metrics are never written to the boards database.

## Agents

| Variable | What it sets |
|---|---|
| `REMO_AI_API_KEY`, `REMO_AI_BASE_URL`, `REMO_AI_MODEL` | default provider |
| `REMO_AI_TIMEOUT_MS` | timeout of a model call |
| `REMO_AGENT_MAX_TOKENS`, `REMO_AGENT_MAX_COST_USD`, `REMO_AGENT_MAX_ACTIONS` | upper bounds of the budget |
| `REMO_AGENT_MAX_QUEUED` | how many tasks can wait at once |

Without a key tasks finish with `AI_NOT_CONFIGURED`; the rest of the product works.

## Webhook and debugging

| Variable | What it sets |
|---|---|
| `REMO_WEBHOOK_ALLOW_PRIVATE` | `1` allows an endpoint on the internal network |
| `REMO_DEBUG` | verbose messages about save acknowledgements |
| `REMO_VISITOR_SECRET` | signs the visitor identity in voting; without it the identity changes after a restart |
| `REMO_AI_PRICE_INPUT_PER_MTOK`, `REMO_AI_PRICE_OUTPUT_PER_MTOK` | token prices used to cost a task |
| `REMO_AI_ANCHOR_DIR`, `REMO_AI_ANCHOR_URL`, `REMO_AI_ANCHOR_TOKEN` | where the service writes the journal hash-chain head |

## Where to go next

[Limits](/guide/reference/limits) — default values for these settings.
