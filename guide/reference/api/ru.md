## Аутентификация

| Кто | Чем | Где принимается |
|---|---|---|
| Человек | cookie сессии | все маршруты продукта |
| Интеграция | `Authorization: Bearer remo_it_…` | команды и чтение комнаты |
| Агент | `Authorization: Bearer` токен агента | только маршруты `/agent/**` |

Токен интеграции не принимается на маршрутах агента, а токен агента — на человеческих.

## Комната

В тексте — «комната». В путях, командах и capability сохранено историческое имя `board`: это технические идентификаторы, а не второе название продукта.

| Метод и путь | Что делает |
|---|---|
| `GET /boards?org=<slug>&q=&sort=&dir=&page=&trash=` | домашняя страница: плитки комнат, поиск, сортировка и страницы |
| `GET /boards/:id` | метаданные комнаты и ваша роль |
| `PATCH /boards/:id/icon` | эмодзи плитки: `{icon}`; пустая строка убирает |
| `DELETE /boards/:id` | убрать комнату в корзину |
| `POST /boards/:id/restore` | вернуть комнату из корзины (владелец) |
| `POST /boards/:id/duplicate` | копия комнаты (владелец или со-владелец) |
| `GET /boards/:id/access` | решение о доступе для текущего зрителя |
| `GET /boards/:id/widgets` | объекты комнаты (токену нужен `board.read`) |
| `POST /boards/:id/commands` | выполнить команду (токену нужен `board.edit`) |
| `GET /boards/:id/link` | состояние публичной ссылки |
| `PUT /boards/:id/link` | включить или выключить ссылку, задать пароль и срок |
| `GET /boards/:id/people` | люди комнаты для assignee; без email, нужен аккаунт |
| `GET /boards/:id/grants` | список доступов с именами |
| `POST/DELETE /boards/:id/grants` | выдать или снять роль; co-owner — только с `board.manage` |
| `GET /boards/:id/comments` | треды, сообщения и непрочитанные |
| `POST /boards/:id/comments` | создать тред с якорем `widget` или `point` |
| `POST /boards/:id/comments/:threadId/replies` | ответ; переоткрывает resolved |
| `PATCH /boards/:id/comments/:threadId` | `{resolved: true|false}` |
| `POST /boards/:id/comments/:threadId/read` | отметить тред прочитанным |
| `POST /boards/:id/comments/restore` | заменить треды из бэкапа; нужен `board.backup` |
| `PATCH/DELETE /boards/:id/comment-messages/:id` | правка/удаление своего; удаление — ещё и `board.manage` |

## Команды

`POST /boards/:id/commands` принимает `{command, input, ifVersion?}` и требует заголовок
`Idempotency-Key`. Ответ: `{result, version, replayed?}`.

| Команда | `input` |
|---|---|
| `board.item.create` | `{type: "sticky_note"\|"text"\|"shape"\|"frame", x, y, width?, height?, content?, name?, style?}` |
| `board.item.update` | `{id, patch: {x?, y?, width?, height?, title?, content?, name?, style?, locked?}}` |
| `board.item.delete` | `{id}` |
| `board.text.set` | `{id, text}` |
| `board.connector.create` | `{from, to, routing?, arrow?, waypoints?, style?, id?}` |
| `board.connector.update` | `{id, routing?, waypoints?}` |

`name` — необязательная подпись до 120 символов; пустая строка убирает её, уникальность не проверяется. Все шесть команд требуют capability `board.edit`. `ifVersion` сверяется с текущей версией документа:
несовпадение — `409 STALE`. Правка или удаление заблокированного объекта отклоняется с
`OBJECT_LOCKED`; `locked: false` принимается только от автора или носителя `board.manage`,
иначе — `LOCKED_BY_OTHER`.

## Экспорт

| Метод и путь | Что делает |
|---|---|
| `POST /boards/:id/export-jobs` | `{scope, format, objectCount}` → `{jobId}` |
| `POST /boards/:id/export-jobs/:jobId/complete` | отметить завершение и записать размер |
| `GET /boards/:id/backup` | полный JSON-бэкап с контрольной суммой |

`scope` — `selection`, `frame` или `board`; `format` задания — `png` или `pdf`. Бэкап — отдельный `GET /boards/:id/backup`, не формат задания.

## Организация

| Метод и путь | Что делает |
|---|---|
| `GET /orgs` | организации аккаунта: `kind`, `relation`, `state`, capabilities |
| `GET /orgs/:id` | организация, членство и роли вызывающего |
| `PATCH /orgs/:id` | `{name}` — переименовать (администратор организации) |
| `POST /orgs/:id/teams` | `{name}` — создать команду |
| `PATCH/DELETE /orgs/:id/teams/:teamId` | переименовать или удалить команду |
| `GET/POST /orgs/:id/teams/:teamId/members` | участники команды |
| `DELETE /orgs/:id/teams/:teamId/members/:userId` | убрать участника |
| `PATCH /auth/me` | `{name?, handle?}` — имя и обязательный `@ник` |
| `GET /orgs/:id/apps` | установленные приложения с панелями |
| `POST /orgs/:id/apps` | установить по `{appId}` |
| `PATCH /orgs/:id/apps/:appId` | `{enabled}` — выключить или включить |
| `DELETE /orgs/:id/apps/:appId` | удалить |
| `POST /orgs/:id/apps/:appId/invoke` | `{boardId, action}` — выполнить действие |
| `GET /orgs/:id/integration-tokens` | список токенов без секретов |
| `POST /orgs/:id/integration-tokens` | `{label, scopes, expiresInDays}` → секрет один раз |
| `DELETE /orgs/:id/integration-tokens/:tokenId` | отозвать |

Вебхук — в [справочнике событий](/guide/reference/events).

## Пример

:::tabs
:::tab Запрос
```bash
curl -X POST https://boards.example.com/api/boards/$BOARD/commands \
  -H "Authorization: Bearer remo_it_…" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: note-1" \
  -d '{"command":"board.item.create","input":{"type":"sticky_note","x":0,"y":0}}'
```
:::
:::tab Ответ
```json
{
  "result": { "id": "item_7c1e2f3a9b4d", "type": "sticky_note" },
  "version": "9f0c3a4e6f3a4e57",
  "replayed": false
}
```
:::
:::

## Куда дальше

[Коды ошибок](/guide/reference/errors) — что означает отказ и какое действие его снимает.
