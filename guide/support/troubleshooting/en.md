## Sign-in and access

| Symptom | Cause | What to check |
|---|---|---|
| Sign-in appears to succeed, but there is no session | no HTTPS at `NODE_ENV=production` | the `Secure` cookie is not stored without TLS |
| `401 AUTH_REQUIRED` with an account present | the cookie is lost or has expired | session lifetime 30 days, the domain and `SameSite` |
| `403 FORBIDDEN` on an action | the role does not give the capability | the role table and role sources |
| `404` on a board that exists | another account or organisation | access and `organization` in the address |
| The link does not open | disabled, expired, or the password changed | the **Публичная ссылка** (public link) block |
| No discussion is visible | you opened a link without an account, or the role is below **Commenter** | the account and the board role |
| A lock cannot be released | another person locked the object | ask the author or a board manager |

## Socket and saving

| Symptom | Cause | What to check |
|---|---|---|
| Edits are not visible to others | the socket is not connected | the indicator, `101 Switching Protocols` in the network tab |
| The indicator stays on `connecting` | the proxy does not pass WebSocket | `location /sync/` and the `Upgrade` headers |
| `офлайн (N)` (offline) does not clear | the connection has not been restored | the network, then reload the tab |
| `ввод остановлен` (input stopped) | the queue reached 1000 changes | restore the connection; edits in the queue are kept |
| After access is revoked, edits are not accepted | the tab is in read-only mode | this is expected behaviour |

## Export and backup

| Symptom | Cause | What to check |
|---|---|---|
| "Nothing to export in this scope" | nothing is selected for the chosen scope | select objects or a frame |
| No backup option | the role lacks `board.backup` | an editor role and above |
| Import refused | a damaged file or a wrong checksum | the integrity of the JSON and `manifest` |
| The PDF is empty | rendering happens in the browser | disabled extensions, board size |

## Events and integrations

| Symptom | Cause | What to check |
|---|---|---|
| The event did not arrive | the endpoint is not configured or does not answer `2xx` | `GET …/webhook/deliveries` |
| Events pile up in the DLQ | the endpoint is consistently unreachable | `dead=1`, `lastError`, then replay |
| `401 INTEGRATION_TOKEN_*` | the token is unknown, revoked, or expired | issue a new one |
| `403 SCOPE_REQUIRED` | the token does not have the required scope | `board.read` / `board.edit` |
| `409 WEBHOOK_LOCKED` | `REMO_KEK` is not set | the key and its reserve |

## Agents

| Symptom | Cause | What to check |
|---|---|---|
| `AI_NOT_CONFIGURED` | there is no provider key | `REMO_AI_*` or the key in the interface |
| `AGENT_DENIED` | agents are off, there are no permissions, or the skill is forbidden | the organisation policy and the owner role |
| `BUDGET_REQUIRED` | a task without a budget | set a budget |
| The task is queued | the limit of concurrent tasks | wait or reduce the load |

## Documentation

| Symptom | Cause | What to check |
|---|---|---|
| `/guide/` answers 404 | the portal is not built or not copied | `pnpm guide:build`, `rsync` to `/srv/remo/docs-site/` |
| `/guide/` opens but `/help/…` does not work | local viewing on a different port | in production both are on the same origin |

## Where to go next

[Known issues and limitations](/guide/support/known-issues) — limitations that are not defects.
