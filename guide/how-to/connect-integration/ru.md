## Когда нужно

Внешняя система должна читать комнату, менять её и получать события об изменениях.

## Предусловия

- Вы администратор организации: выпуск токена и настройка вебхука доступны только администратору.
- У вашего аккаунта есть право редактирования на комнате, с которой будет работать интеграция.
- Эндпоинт доступен по HTTPS, даже во внутренней сети. Внутренний адрес разрешает `REMO_WEBHOOK_ALLOW_PRIVATE=1`, но не отменяет HTTPS.

## Шаги: токен

1. Выпустите токен:

```bash
curl -X POST https://boards.example.com/api/orgs/$ORG/integration-tokens \
  -H "Content-Type: application/json" --cookie "$SESSION" \
  -d '{"label":"ci","scopes":["board.read","board.edit"],"expiresInDays":90}'
```

2. Скопируйте `secret` из ответа: он показывается один раз.
3. Ожидаемый результат: `201` и объект `token` с `scopes`, `expiresAt`, `id`.

## Шаги: первая команда

1. Создайте стикер:

```bash
curl -X POST https://boards.example.com/api/boards/$BOARD/commands \
  -H "Authorization: Bearer remo_it_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: first-note-1" \
  -d '{"command":"board.item.create","input":{"type":"sticky_note","x":0,"y":0}}'
```

2. Повторите запрос с тем же `Idempotency-Key`. Ожидаемый результат: второй объект не создаётся, ответ содержит `replayed: true`.
3. Ожидаемый результат первого запроса: `200`, в `result` — `id` объекта.

## Шаги: вебхук

1. Настройте эндпоинт:

```bash
curl -X PUT https://boards.example.com/api/orgs/$ORG/webhook \
  -H "Content-Type: application/json" --cookie "$SESSION" \
  -d '{"url":"https://example.com/hooks/remo"}'
```

2. Скопируйте `secret` (`whsec_…`): он показывается один раз.
3. Ожидаемый результат: `201`, в ответе `webhook.enabled: true`.

## Проверка подписи

Проверяйте подпись по **сырому телу** запроса, до разбора JSON:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (!parts.v1 || !/^[0-9a-f]+$/i.test(parts.v1) || parts.v1.length % 2) return false;
  const timestamp = Number(parts.t);
  const given = Buffer.from(parts.v1, "hex");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"),
    "hex",
  );
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## Проверка

- Событие приходит на эндпоинт в течение нескольких секунд после команды.
- Подпись сходится на теле, которое вы получили.
- Повторная команда с тем же ключом не создаёт второй объект.

## Частые ошибки

| Симптом | Причина |
|---|---|
| `401 INTEGRATION_TOKEN_EXPIRED` | срок токена истёк — выпустите новый |
| `403 SCOPE_REQUIRED` | у токена нет нужного scope |
| `404 RESOURCE_NOT_AVAILABLE` | владелец токена не видит комнату |
| Событие не пришло | эндпоинт не настроен или отвечает не `2xx` |

## Куда дальше

[Справочник событий](/guide/reference/events) — конверт, типы и повторы.
