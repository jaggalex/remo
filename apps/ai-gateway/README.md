# @remo/ai-gateway

The optional remo AI gateway (ADR-251, `spec/ai-gateway.md`). It is the only process that
talks to model providers: sync sends one OpenAI-compatible request, the gateway applies a
registry, kill switches and limits, then logs metadata only.

Plain ESM, Node 22, no dependencies except `@remo/outbound`. The outbound client supplies
DNS pinning, the private-address ban and redirect refusal; the gateway does not weaken it.

## Run

```sh
GATEWAY_TOKEN="$(openssl rand -hex 32)" \
GATEWAY_ADMIN_TOKEN="$(openssl rand -hex 32)" \
GATEWAY_CONFIG="$PWD/apps/ai-gateway/config.example.json" \
GATEWAY_STATE_DIR="$PWD/apps/ai-gateway/.data" \
node apps/ai-gateway/server.mjs
```

The example config listens on `10.77.0.2:8080`, which does not exist on a laptop; copy it
and change `listen`/`admin` to loopback for a local run. `GATEWAY_METRICS_TOKEN` is
optional: without it `/metrics` answers `404`.

`SIGHUP` reloads `config.json`. A file that fails validation leaves the previous registry
in place and writes the reason to stderr; `remo-gw reload` does the same through the admin
API. Providers, models, regions, key names and limits take effect immediately; `listen`
and `admin` are socket addresses and need a restart.

### Environment

| Variable | Meaning |
|---|---|
| `GATEWAY_TOKEN` | Shared secret with sync. Required. |
| `GATEWAY_CONFIG` | Registry path, default `/etc/remo-ai-gateway/config.json`. |
| `GATEWAY_STATE_DIR` | State and logs, default `/var/lib/remo-ai-gateway`. |
| `GATEWAY_ADMIN_TOKEN` | Admin token; otherwise read from `GATEWAY_ADMIN_TOKEN_FILE`. |
| `GATEWAY_ADMIN_TOKEN_FILE` | Default `/etc/remo-ai-gateway/admin.token`. |
| `GATEWAY_METRICS_TOKEN` | Bearer token for `/metrics`; no token means no endpoint. |
| `GATEWAY_TLS_CERT`, `GATEWAY_TLS_KEY` | Optional PEM pair; without them the listener is plain HTTP for the tunnel. |
| provider `keyEnv` names | Installation keys, read from the gateway's environment. |

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /v1/chat/completions` | gateway token | The one model call. |
| `GET /v1/upstreams/check?baseUrl=` | gateway token | Is a BYOK base URL in the registry? |
| `GET /healthz` | none | `{"status":"ok"}`, no details. |
| `GET /metrics` | metrics token | Prometheus text; `404` without a token. |
| `127.0.0.1:<admin>` | admin token | Operator API used by `remo-gw`. |

Request headers are `Authorization`, `X-Remo-Upstream` (provider id or BYOK base URL),
`X-Remo-Upstream-Key`, `X-Remo-Org`, `X-Remo-User`, `X-Remo-Task`, `X-Remo-Region` and
`X-Request-Id`. Only `Authorization`, `Content-Type` and `X-Title` leave for the provider.

Errors are `{"error":{"code","message",…}}` with the codes from the spec: `GATEWAY_AUTH`
401, `PROVIDER_NOT_ALLOWED` / `REGION_NOT_ALLOWED` 403, `KILLED` 423 (`scope`, optional
`reason`), `RATE_LIMITED` 429 (`Retry-After`), `UPSTREAM_ERROR` 502 (`upstreamStatus`),
`UPSTREAM_TIMEOUT` 504, `GATEWAY_BUSY` 503. The gateway also uses `INVALID_REQUEST` 400,
`REQUEST_TOO_LARGE` 413 and `NOT_FOUND` 404 for malformed input.

A successful answer is the provider's body and status, plus
`X-Remo-Gateway-Provider`, `X-Remo-Gateway-Latency-Ms` and
`X-Remo-Gateway-Usage: in=…,out=…`.

## Registry and state

`config.json` is `spec/ai-gateway.md` §4.1; see `config.example.json`. A provider may be
addressed by `id` or by any URL in `match` (normalised: lower-case host, no trailing
slash). Models are exact names or a pattern ending in `*`. `byok: false` refuses a key
sent in `X-Remo-Upstream-Key` and requires `keyEnv`.

`state.json` holds kill switches (`global`, `provider.<id>`, `org.<id>`, `user.<id>`),
per-organisation limit overrides and daily counters. It is written atomically and flushed
once a minute and on shutdown. `until` expires a switch lazily on the next check. Counters
roll over at 00:00 UTC and survive a restart. Cost is stored next to the token counters
(`usage.cost`) because one number cannot carry both.

Request order is fixed: auth → parse → provider → kill switches (global, provider, org,
user) → rate windows (global, provider, org, user) → daily tokens and spend → concurrency
semaphore (wait at most 2 s) → provider → usage → journal.

## CLI

```sh
export GATEWAY_ADMIN_TOKEN=…   # or GATEWAY_ADMIN_TOKEN_FILE
export GATEWAY_ADMIN_URL=http://127.0.0.1:8081
node apps/ai-gateway/bin/remo-gw.mjs status
node apps/ai-gateway/bin/remo-gw.mjs providers
node apps/ai-gateway/bin/remo-gw.mjs providers test openrouter --model openai/gpt-4o
node apps/ai-gateway/bin/remo-gw.mjs kill provider openrouter --reason "incident" --for 2h
node apps/ai-gateway/bin/remo-gw.mjs unkill provider openrouter
node apps/ai-gateway/bin/remo-gw.mjs limits set org <id> --tokens-per-day 5000000 --rpm 60
node apps/ai-gateway/bin/remo-gw.mjs usage --org <id> --day 2026-11-20
node apps/ai-gateway/bin/remo-gw.mjs reload
node apps/ai-gateway/bin/remo-gw.mjs tail --org <id> [--follow]
```

`tail` prints recent metadata records and follows when standard output is a terminal; add
`--follow` to force it or pipe the command for a one-shot read. Every mutating command
writes `admin.log` through the admin API.

## Logs and metrics

`requests.log` is JSONL, rotated to `requests-<day>.log` at the UTC day boundary and kept
for 30 days. Fields: `ts,rid,org,user,task,provider,model,status,code,latencyMs,in,out,cost`.
It never contains a request or response body, a key, `Authorization`, or provider error
text. `admin.log` records operator actions; diagnostic messages on stderr go through
`sanitize`, which removes `sk-…` and `Bearer …` and truncates.

Prometheus families: `remo_gw_requests_total`, `remo_gw_latency_seconds` (histogram),
`remo_gw_tokens_total`, `remo_gw_cost_total`, `remo_gw_killed_total`,
`remo_gw_rate_limited_total`, `remo_gw_inflight`, `remo_gw_upstream_errors_total`. No
organisation id appears in a label.

## Tests

```sh
pnpm test apps/ai-gateway
```

The suites use fake HTTP providers and temporary state directories and do not touch the
database. The repository's shared vitest setup still performs its usual test-database
preflight before the workers start. Redirect and private-address refusals are still
exercised through the real `@remo/outbound` path where they reject before connecting.

## Scope

This is stage 2 of `spec/ai-gateway.md` §11. sync's gateway mode, fail-closed behaviour,
BYOK save-time checks, `ai_runs.gateway_provider`, WireGuard, nftables, compose/systemd and
the admin guide are later stages and are not part of this package. The service can terminate
TLS itself when `GATEWAY_TLS_CERT` and `GATEWAY_TLS_KEY` are set; binding the socket or the
address policy remains a deployment concern.
