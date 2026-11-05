## Основные

| Переменная | Что задаёт | Без неё |
|---|---|---|
| `DATABASE_URL` | Postgres с комнатами, IAM и журналом | сервис откажется стартовать, если база задана, но недоступна; без переменной работает режим диска |
| `PORT` | порт sync-сервиса | 1234 |
| `REMO_DATA_DIR` | каталог для режима диска | `apps/sync/.data` |

## Пример

```bash
# /srv/remo/.env, права 600, владелец — пользователь сервиса
DATABASE_URL=postgres://remo:<пароль>@127.0.0.1:5432/remo
NODE_ENV=production
PORT=1234
REMO_APP_ORIGIN=https://boards.example.com
REMO_CORS_ORIGIN=https://boards.example.com
REMO_METRICS_TOKEN=<32 случайных байта>
REMO_DATA_DIR=/var/lib/remo
REMO_KEK=<openssl rand -base64 32>
REMO_KEK_ID=v1
```

## Безопасность и ключи

| Переменная | Что задаёт |
|---|---|
| `REMO_KEK` | ключ-обёртка для секретов: 32 байта в base64 |
| `REMO_KEK_ID` | версия ключа, по умолчанию `v1` |
| `REMO_APP_ORIGIN` | адрес приложения для ссылок в письмах и приглашениях |
| `REMO_CORS_ORIGIN` | разрешённый origin для API; `*` по умолчанию |

Без `REMO_KEK` нельзя добавить ключ провайдера и настроить вебхук: сервер ответит `WEBHOOK_LOCKED` или `AI_CREDENTIALS_LOCKED`. Уже сохранённые секреты при потере ключа не расшифровываются.

## Метрики

| Переменная | Что задаёт |
|---|---|
| `REMO_METRICS_DATABASE_URL` | отдельная база продуктовых метрик |
| `REMO_METRICS` | `off` выключает инструментацию явно |
| `REMO_METRICS_TOKEN` | токен для `/metrics`; в production обязателен |

Метрики никогда не пишутся в базу комнат.

## Агенты

| Переменная | Что задаёт |
|---|---|
| `REMO_AI_API_KEY`, `REMO_AI_BASE_URL`, `REMO_AI_MODEL` | провайдер по умолчанию |
| `REMO_AI_TIMEOUT_MS` | таймаут вызова модели |
| `REMO_AGENT_MAX_TOKENS`, `REMO_AGENT_MAX_COST_USD`, `REMO_AGENT_MAX_ACTIONS` | верхние границы бюджета |
| `REMO_AGENT_MAX_QUEUED` | сколько задач может ждать одновременно |

Без ключа задачи завершаются `AI_NOT_CONFIGURED`; остальной продукт работает.

## Прокси и лимиты

| Переменная | Что задаёт |
|---|---|
| `REMO_TRUST_PROXY` | `1` — доверять `X-Forwarded-For` за обратным прокси |
| `REMO_LOGIN_LIMIT` | попыток входа на пару «почта + IP» за 15 минут; по умолчанию 10 |
| `REMO_LOGIN_IP_LIMIT` | попыток входа с одного IP за 15 минут; по умолчанию 100 |
| `REMO_REGISTER_LIMIT` | регистраций с одного IP в час; по умолчанию 20 |
| `REMO_HASH_CONCURRENCY` | параллельных хеширований пароля; по умолчанию 4 |
| `REMO_AI_ALLOW_PRIVATE` | `1` разрешает AI-выход во внутреннюю сеть; по умолчанию выключено |

## Вебхук и отладка

| Переменная | Что задаёт |
|---|---|
| `REMO_WEBHOOK_ALLOW_PRIVATE` | `1` разрешает эндпоинт во внутренней сети |
| `REMO_DEBUG` | подробные сообщения о подтверждениях сохранения |
| `REMO_VISITOR_SECRET` | секрет, которым подписывается идентификатор посетителя в голосовании; без него он меняется после перезапуска |
| `REMO_AI_PRICE_INPUT_PER_MTOK`, `REMO_AI_PRICE_OUTPUT_PER_MTOK` | цена токенов для расчёта стоимости задачи |
| `REMO_AI_ANCHOR_DIR`, `REMO_AI_ANCHOR_URL`, `REMO_AI_ANCHOR_TOKEN` | куда сервис пишет голову хеш-цепочки журнала |

## Куда дальше

[Лимиты](/guide/reference/limits) — значения по умолчанию для этих настроек.
