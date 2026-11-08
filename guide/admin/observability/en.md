## Health

`GET /api/health` is public. The body always contains `ok`, `store`, the number of connections, rooms, uptime and store details; the code is `200` with a healthy store and `503` when the store has a problem.

## Metrics

`GET /metrics` is in Prometheus format and requires `Authorization: Bearer $REMO_METRICS_TOKEN` in production. nginx closes `/api/metrics` from outside: scrape metrics from loopback.

| Metric | What it shows |
|---|---|
| `remo_build_info` | version, build number, commit and schema of the running service |
| `remo_http_requests_total` | requests by route |
| `remo_ws_connections_total`, `_active` | accepted and open sockets |
| `remo_ws_rejected_total` | refused upgrades |
| `remo_ws_readonly_write_attempt` | write attempts from read-only |
| `remo_ws_quota_closed_total` | socket closes by write quota; the reason is `rate` or `room-full` |
| `remo_ws_edit_audit_rows_total` | edit windows written to audit |
| `remo_ws_edit_audit_dropped_total` | edit windows whose audit write failed |
| `remo_rooms_active` | rooms in memory |
| `remo_store_writes_total`, `remo_store_write_errors_total` | store writes and errors |
| `remo_store_compactions_total` | journal compactions |

## Logs

- `journalctl -u remo-sync -f` — service, rooms, access.
- `journalctl -u remo-sync | grep '\[agent\]'` — agent tasks and model errors.
- `journalctl -u remo-sync | grep '\[events\]'` — event delivery.
- `/var/log/nginx/error.log` — proxying and sockets.

## Product metrics

When `REMO_METRICS_DATABASE_URL` is set, product events are written to a separate database (not the room database). Without it the instrumentation is a no-op; `REMO_METRICS=off` switches it off explicitly.

## Edit audit

Edits over the connection reach the organisation audit as one record per session, room and 60 s window: edit and byte counts, object ids and fields. Room content is not written. The record is available to the organisation administrator and the security administrator under organisation → **History**; this action has no separate human-readable label yet. If the write fails, `remo_ws_edit_audit_dropped_total` grows.

## What to look at for a complaint

1. `/health` — whether the service is alive and the store is visible.
2. `journalctl` for the window of the complaint — access, socket and agent errors.
3. Metrics: a rise in refusals or in write attempts from read-only means an access problem. A rise in `remo_ws_quota_closed_total` means too frequent edits or a full room; a rise in `remo_ws_edit_audit_dropped_total` means an audit write failure.
4. The agent journal and the organisation AI journal — if the complaint is about a task.

## Where to go next

[Troubleshooting](/guide/support/troubleshooting) — typical symptoms and causes.
