## Здоровье

`GET /api/health` — публичный. Тело всегда содержит `ok`, `store`, число соединений, комнат, uptime и подробности стора; код `200` при здоровом сторе и `503`, если проблема со стором.

## Метрики

`GET /metrics` — формат Prometheus, требует `Authorization: Bearer $REMO_METRICS_TOKEN` в production. nginx закрывает `/api/metrics` снаружи: снимайте метрики с loopback.

| Метрика | Что показывает |
|---|---|
| `remo_http_requests_total` | запросы по маршрутам |
| `remo_ws_connections_total`, `_active` | принятые и открытые сокеты |
| `remo_ws_rejected_total` | отказы в апгрейде |
| `remo_ws_readonly_write_attempt` | попытки записи от read-only |
| `remo_rooms_active` | комнаты в памяти |
| `remo_store_writes_total`, `remo_store_write_errors_total` | записи и ошибки стора |
| `remo_store_compactions_total` | компакции журнала |

## Журналы

- `journalctl -u remo-sync -f` — сервис, комнаты, доступ.
- `journalctl -u remo-sync | grep '\[agent\]'` — задачи агентов и ошибки модели.
- `journalctl -u remo-sync | grep '\[events\]'` — доставка событий.
- `/var/log/nginx/error.log` — проксирование и сокеты.

## Продуктовые метрики

Если задан `REMO_METRICS_DATABASE_URL`, события продукта пишутся в отдельную базу (не в базу досок). Без неё инструментация — no-op; `REMO_METRICS=off` выключает её явно.

## Что смотреть при жалобе

1. `/health` — жив ли сервис и виден ли стор.
2. `journalctl` за окно жалобы — ошибки доступа, сокетов, агентов.
3. Метрики: рост отказов или попыток записи от read-only означает проблему с правами.
4. Журнал агента и AI-журнал организации — если жалоба про задачу.

## Куда дальше

[Устранение неполадок](/guide/support/troubleshooting) — типовые симптомы и причины.
