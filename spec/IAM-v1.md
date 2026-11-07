# IAM v1 — целевые требования

**Версия:** 1.2 · **Дата:** 06.11.2026 · **Основа:** ADR-061…ADR-178.
Этот файл — нормативный: он описывает **что строим** и какие границы считаем
обязательными. ADR-161…168 уточняют модель: личная организация, домашняя страница,
`@ник`, имена объектов и приостановка без отзыва сессии.

## 1. Принципы

1. **Шесть вещей раздельно:** аутентификация, членство, административные полномочия,
   доступ к контенту, лицензия/entitlement, провижининг. Нет глобального `user.role`.
2. **Единица авторизации — комната.** Yjs-документ нельзя авторизовать по виджетам, и это
   осознанное ограничение: права считаются на комнату, а не на объект.
3. **Deny by default.** Нет правила, дающего доступ → доступа нет. UI-скрытие не защита.
4. **Права не выдаются ролью администратора.** `org_admin` не открывает приватные комнаты.
5. **Отзыв — по источнику.** Снять один grant не значит отозвать доступ: он может прийти
   из команды, организации или ссылки; ответ обязан перечислить оставшиеся источники.
6. **Публичная ссылка неперсонифицируема.** Её нельзя отозвать у одного человека, только
   выключить или ротировать.
7. **Всё, что можно проверить тестом, — проверяется тестом.** Acceptance ниже нормативны.

## 2. Продуктовая модель v1

| Уровень | Что это в v1 | Чего нет в v1 |
|---|---|---|
| Пользователь | email + пароль, имя, обязательный уникальный `@ник`, состояние `active/suspended` | MFA, magic-link, соцвходы |
| Организация | личная у каждого аккаунта или общая; `kind = personal/shared`; переключение и домашняя страница | биллинг |
| Команда | группа комнат внутри организации; участники, `team_admin`, переименование и удаление | SCIM-группы, вложенность, discovery-политики |
| Комната | один владелец, co-owner/editor/viewer, гость, публичная ссылка | Space, папки, шаблоны на уровне org |
| Лицензия | один флаг `can_edit` на участника org | тарифы, квоты, гостевые лимиты |

Пользователь может состоять в нескольких организациях; переключатель и домашняя страница
(`?org=<slug>`) входят в v1. Каждый аккаунт всегда имеет личную организацию.

## 3. Роли и capabilities

**Организация:** `org_admin`, `user_admin`, `security_admin`, `content_admin` — назначаются
только `org_admin`, с повторной аутентификацией (step-up) и записью в аудит. Роли
независимы: человек может держать несколько сразу, иерархии между ними нет. Последнего
`org_admin` нельзя снять без преемника (409 `LAST_ADMIN`).

**Команда:** `team_admin` — только в своей команде; назначает администраторов команды,
управляет её участниками.

**Комната:**

| capability | viewer | commenter¹ | editor | co-owner | owner |
|---|---|---|---|---|---|
| `board.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `board.comment` | | ✓¹ | ✓¹ | ✓ | ✓ |
| `board.edit` | | | ✓ | ✓ | ✓ |
| `board.share` | | | при `can_share` | ✓ | ✓ |
| `board.export` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `board.backup` | | | ✓ | ✓ | ✓ |
| `board.facilitate` | | | ✓ | ✓ | ✓ |
| `board.manage` (назначать co-owner, менять политику комнаты) | | | | ✓ | ✓ |
| `board.transfer`, `board.delete` | | | | | ✓ |

¹ **`commenter` = read + comment.** Комментарии — серверные записи (ADR-104/105), а не
запись в Yjs: роль может писать обсуждение, не получая права менять комнату. Viewer
читает комментарии, но не пишет; ссылка-посетитель обсуждение не видит. ADR-063
дополнен, исходное «commenter равен viewer» больше не действует.

**Гость** — `org_memberships.relation = guest` + персональные `board_grants`. Гость не
получает `team_memberships`, не создаёт комнаты, не меняет sharing. `guest` не может быть
`owner`/`co-owner`/`team_admin`.

**Публичная ссылка** — одно свойство комнаты `{enabled, password_hash,
password_version, expires_at}`, а не токен (ADR-069). URL один и тот же: повторное
включение активирует его снова, поэтому интерфейс предупреждает об этом до включения.
Роль — только `viewer`; по умолчанию выключена и включается явным действием
владельца/со-владельца. Пароль и срок проверяются на сервере; разблокировка паролем —
httpOnly-cookie, привязанная к `password_version`. Организационный запрет
(`org_policies.public_links`) появится вместе с админ-экраном: в v1 его некому
выставить, поэтому доступ решает сама ссылка.

## 4. Как считается доступ (одна функция, без DSL)

Политики в v1 — это **не язык**, а детерминированная функция с явным порядком:

```
effective(board, viewer) -> { role, capabilities[], sources[], reason }
```

1. Нет аутентификации и нет валидной ссылки → `AUTH_REQUIRED`.
2. `users.state = suspended` или `org_membership.state = suspended` → `ORG_SUSPENDED`
   (deny перекрывает всё остальное).
3. `board.archived` → только `board.read` владельцу и co-owner.
4. Собрать кандидатов: `owner_id`, `co-owner` grants, `editor/commenter/viewer` grants,
   grants команды комнаты, grants организации, публичная ссылка (если `visibility = link`).
5. `role = max(кандидаты)`; `owner` — отдельное основание, не «пятая роль в шкале».
6. `capabilities` — по таблице роли; `board.share` для `editor` дополнительно требует
   `org_policy.can_share`.
7. `sources` — все сработавшие основания (для объяснения и для AC-28).
8. Любая ошибка вычисления → deny + `POLICY_ERROR` (fail closed).

**Запрет по умолчанию.** `org_admin`/`content_admin` не добавляют `board.read` к приватной
комнате. `content_admin` в v1 **не реализуется** — это отдельное основание доступа, которое
требует уведомления владельца; отложено (см. §12).

**Кэш:** `boards.acl_version` инкрементируется на любом изменении, влияющем на доступ.
Вычисление кэшируется в памяти sync-сервера на `(board, user)` с ключом версии; TTL не
используется — версия и есть инвалидация.

## 5. Данные (Postgres, схема `iam`)

```
users(id uuid pk, email citext unique, password_hash text, name text,
      handle text unique, state text check in ('active','suspended'),
      theme text, lang text, created_at, updated_at)

sessions(id uuid pk, user_id fk, token_hash bytea unique, created_at,
         last_seen_at, expires_at, revoked_at,
         user_agent text, ip inet)

orgs(id uuid pk, name text, slug text unique, kind check in ('personal','shared'),
     created_by fk users(id), created_at)

org_memberships(org_id fk, user_id fk, relation check in ('member','guest'),
                state check in ('invited','active','suspended','removed'),
                created_at, primary key(org_id, user_id))

admin_roles(org_id, user_id, role check in ('org_admin','user_admin',
            'security_admin','content_admin'), granted_by, granted_at,
            primary key(org_id, user_id, role))

teams(id uuid pk, org_id fk, name text, created_at,
      unique(org_id, name))

team_memberships(team_id, user_id, role check in ('member','admin'),
                 source check in ('direct','group'), created_at,
                 primary key(team_id, user_id, source))

boards(id uuid pk, org_id fk, team_id fk null, title text, icon text,
       owner_id fk users(id) null,              -- null — только закрытая legacy-комната (ADR-174)
       created_by fk users(id) null,            -- автор, не текущий владелец
       visibility check in ('private','link') default 'private',
       acl_version bigint not null default 1,
       archived_at timestamptz null, created_at, updated_at)

board_grants(id uuid pk, board_id fk, subject_type check in ('user','team','org'),
             subject_id uuid, role check in ('viewer','commenter','editor','coowner'),
             granted_by fk users(id), expires_at null,
             unique(board_id, subject_type, subject_id))

board_links(board_id fk, role check in ('viewer'),
            enabled bool, version int, created_by, created_at,
            password_hash text null, password_version int not null default 1,
            expires_at timestamptz null, primary key(board_id))

board_link_unlocks(token_hash bytea pk, board_id fk, password_version int,
                   expires_at timestamptz, created_at)

invitations(id uuid pk, org_id fk, target_type check in ('org','team','board'),
            target_id uuid null, email citext, subject_kind check in ('member','guest'),
            role text, token_hash bytea unique, state check in
            ('pending','accepted','revoked','expired'), expires_at,
            created_by, accepted_by null, accepted_at null, created_at)

board_claims(board_id fk pk, token_hash bytea unique, claimed_by null,
             claimed_at null, created_at)

audit_events(id bigserial pk, at timestamptz default now(), actor_id uuid null,
             org_id uuid null, board_id uuid null, action text,
             subject text, before jsonb, after jsonb, request_id text, reason text)

org_policies(org_id fk pk, can_share bool default true,
             public_links bool default false, invite_members bool default true)
```

Инварианты: `boards.owner_id` активен и состоит в org; `team_memberships` только для
участников org; `board_grants.subject_type='team'` требует team в той же org; ссылка
существует только при `visibility='link'`.

### Tenant isolation (RLS)

Схема 18 закрывает тенантскую изоляцию в PostgreSQL (ADR-178). Tenant-таблица либо имеет
`org_id`, либо получает его через политику с `boards`, либо наследует от родителя; `orgs`
сопоставляется по `id`. Глобальные `users`, `sessions`, `agent_tokens`, `ai_credentials` и
`schema_meta` — исключения: они читаются до того, как известна организация или аккаунт, и
остаются auth-границей со своим хэшированием токенов, rate limit и шифрованием секретов.

- Все tenant-таблицы под `FORCE ROW LEVEL SECURITY`: контент, доступ, организации, команды,
  приглашения, токены интеграций, агенты, AI-журнал, аудит и outbox.
- Сервис подключается как `remo_app`: только `select/insert/update/delete`, без владения
  таблицами и без `BYPASSRLS`. Схема и обслуживание идут owner-ролью через
  `REMO_MIGRATION_DATABASE_URL`; owner должен быть superuser или иметь `BYPASSRLS`, иначе
  security-definer-функции вернут ноль строк.
- Запрос, который трогает tenant-данные, получает `app.org_id` через
  `set_config('app.org_id', $1, false)`. Пул сбрасывает настройку перед возвратом, а ошибка
  сброса уничтожает соединение. Без настройки политика возвращает ноль строк, а не все.
- Проверка: `pnpm db:rls --check` (инвентарь, 0 gaps) и `pnpm db:rls:enable --check`
  (37 таблиц: 32 tenant, `orgs` и четыре таблицы, наследующие tenant через родителя). Это
  не входит в `pnpm db:check`; запускать после изменения схемы и перед релизом.

## 6. Аутентификация и сессии

- `POST /auth/register` — email, пароль, имя. Создаёт пользователя, **личную организацию**
  и команду `General` (владелец — он), открывает сессию. Пароль: `scrypt` (N=32768, r=8,
  p=1, 64 байта), сравнение постоянного времени; минимум 10 символов.
- `POST /auth/login` — email + пароль; при неудаче — одинаковый ответ и задержка.
- `POST /auth/logout` — отзывает текущую сессию.
- `GET /auth/me` — пользователь, все его организации (`kind`, членство, capabilities),
  csrf-токен.
- Сессия: cookie `remo_session` (`httpOnly`, `SameSite=Lax`, `Secure` в prod), 30 дней
  скользяще; сервер хранит только SHA-256 токена.
- CSRF: `SameSite=Lax` + проверка `Origin` на всех мутациях + double-submit
  `X-CSRF-Token` (значение из `/auth/me`).
- Rate limit: 10 попыток входа на `ip+email` за 15 минут, в памяти; при перезапуске
  сбрасывается (Redis — позже).
- Email-верификации и сброса пароля нет, пока нет почты. Это **известное ограничение
  v1**; компенсируется политикой пароля и rate limit. `POST /auth/password` (смена по
  текущему паролю) есть.

## 7. Синхронизация (WebSocket)

- Клиент подключается к `/sync?room=<boardId>` через тот же origin; сессия — cookie.
  Для публичной ссылки — тот же URL: доступ решает `visibility = link` и состояние
  ссылки. Пароль разблокируется отдельным запросом и cookie `remo_link_unlock`.
- Handshake: сервер вычисляет `effective()`; нет `board.read` → закрыть `4403`.
  `suspended` → `4401`. Неизвестная комната → `4404` (не раскрывая существование).
  Комната без владельца → `403` до upgrade, без Yjs-документа: `UNCLAIMED` — отказ, а не
  роль.
- **Только чтение:** роль ниже `editor` (и любая ссылка) → сервер разрешает **ровно
  один `syncStep1`** (запрос документа) и `awareness` (курсоры); всё остальное
  отбрасывается, включая `syncStep2` и update. Тип сообщения и шаг синхронизации —
  varint и читаются декодером `lib0`, а не по первому байту: неканоническое кодирование
  нуля не должно обходить фильтр (ADR-109). Попытка записи инкрементирует метрику
  `ws_readonly_write_attempt`.
- **Отзыв:** на мутацию прав сервер немедленно пересчитывает доступ для открытых
  соединений этой комнаты и закрывает/понижает их (`4403`). Дополнительно — sweep каждые
  30 с (heartbeat) пересчитывает `session.valid && acl_version`; расхождение → закрыть.
  SLO v1: **≤30 с**; 10 с — вместе с pub/sub (вне v1).
- Presence: имя и `@ник` берутся из `users.name`/`users.handle`, цвет — из сессии; `?user=` больше не
  авторизует, только отображаемое имя гостя в публичной ссылке.

## 8. HTTP API v1

| Метод, путь | Что | capability |
|---|---|---|
| `POST /auth/register` · `/login` · `/logout` · `GET /auth/me` | сессии | public / self |
| `POST /orgs` · `GET /orgs` · `GET /orgs/{id}` · `PATCH /orgs/{id}` | организация | сессия / членство / `org_admin` для rename |
| `GET /orgs/{id}/members` | справочник людей (гости — только админам) | `member` |
| `POST` · `GET` · `DELETE /orgs/{id}/invitations` | приглашения ссылкой | `user_admin` |
| `PUT /orgs/{id}/admin-roles/{user}/{role}` | админ-роль | `org_admin` (step-up отложен, §13) |
| `POST /orgs/{id}/teams` · `PATCH/DELETE /orgs/{id}/teams/{team}` | команды | `org_admin` |
| `POST /orgs/{id}/teams/{team}/members` | добавить существующего | `org_admin` |
| `DELETE /orgs/{id}/teams/{team}/members/{user}` | снять membership | `org_admin` |
| `POST /orgs/{id}/boards` | создать комнату | `can_edit` + team member |
| `GET /orgs/{id}/boards` | список доступных | member |
| `GET /boards?org=<slug>&q=&sort=&dir=&page=&trash=` | домашняя страница: плитки, поиск, сортировка, страницы | сессия + членство |
| `PATCH /auth/me` | имя и/или `@ник` | self |
| `GET /boards/{id}` | комната + роль | `board.read` |
| `PATCH /boards/{id}/icon` | эмодзи плитки | `board.edit` |
| `PATCH /boards/{id}` | название, команда, архив | `board.manage` |
| `DELETE /boards/{id}` | убрать в корзину (ссылка выключается) | `board.delete` |
| `POST /boards/{id}/restore` | восстановить из корзины (ссылка остаётся off) | владелец |
| `POST /boards/{id}/duplicate` | копия содержимого и доступов, без ссылки | `board.manage` |
| `POST /boards/{id}/transfer` | передать владение | `board.transfer` |
| `GET/POST/DELETE /boards/{id}/grants` | выдать/снять доступ | `board.share`; создание, повышение, понижение и снятие `coowner` — `board.manage` |
| `PUT /boards/{id}/link` | включить/выключить ссылку, пароль, срок | `board.manage` + org policy |
| `POST /boards/{id}/link/unlock` | проверить пароль ссылки | публично, rate limit |
| `POST /boards/{id}/claim` | взять комнату без владельца; токен нужен, только если он задан | сессия; claim-токен, если задан |
| `POST /invitations/accept` | принять приглашение; email проверяется до выдачи прав, внутри транзакции | сессия + совпадение email |
| `GET/POST /boards/{id}/comments` | треды, ответы, resolve/reopen, прочтение | `board.comment`; viewer читает, ссылка-посетитель — нет |
| `GET /orgs/{id}/audit` | журнал (с именами) | `org_admin` / `security_admin` |
| `GET /boards` · `GET /search` | каталог и поиск: только комнаты с `board.read`; комната без владельца не индексируется | `board.read` (аноним без комнаты → 401) |
| `POST /orgs/{id}/members/{user}/suspend` | блокировка | `user_admin` |
| `POST /orgs/{id}/members/{user}/restore` | снять блокировку; сессия не отзывалась и снова работает | `user_admin` |

`GET /metrics` не является продуктовым API: в production требует
`Authorization: Bearer $REMO_METRICS_TOKEN`, иначе 404.

Коды: `401 AUTH_REQUIRED`, `403 FORBIDDEN` (+`reason`), `403 UNCLAIMED` (комната без
владельца), `403 CLAIM_REJECTED` (неверный claim-токен), `403 SSO_REQUIRED` (зарезервирован),
`404 RESOURCE_NOT_AVAILABLE` для чужого tenant и для комнаты без доступа (без метаданных),
`409 LAST_ADMIN`/`OWNER_REQUIRED`/`VERSION_CONFLICT`/`ALREADY_CLAIMED`/`ORG_REQUIRED`/`TEAM_REQUIRED`,
`410 INVITATION_EXPIRED`, `422 EMAIL_MISMATCH`, `429 RATE_LIMITED`.
Мутации принимают `Idempotency-Key`; изменение grants — `If-Match: acl_version`.

## 9. Миграция и claim

1. **Комната без владельца закрыта.** `effective()` возвращает `UNCLAIMED` до любого гранта:
   у такой комнаты нет решения о доступе, поэтому она не читается и не пишется, даже если
   публичная ссылка включена. Все маршруты, кроме `GET /boards/{id}/access` и
   `POST /boards/{id}/claim`, отвечают `403 UNCLAIMED`; сокет закрывается до Yjs.
   `GET /boards/{id}/access` отдаёт `allowed: false`, `reason: "UNCLAIMED"` и пустые
   capabilities, чтобы экран предложил claim. Новые комнаты создаются только с владельцем.
2. **Claim — единственный путь восстановления.** `POST /boards/{id}/claim` принимает
   аутентифицированного пользователя. Если у комнаты задан claim-токен, нужен он; если
   токена никогда не было, достаточно знать комнату. Первый выигрывает гонку
   (`update … where owner_id is null`), повтор → `409 ALREADY_CLAIMED`, неверный токен →
   `403 CLAIM_REJECTED`. Нужны организация и команда: `409 ORG_REQUIRED`/`TEAM_REQUIRED`.
3. Claimed-комната переезжает в первую организацию заявителя (по дате создания) и её первую
   команду; он становится **owner**, `archived_at` снимается, `acl_version` растёт,
   остальные получают приглашения, а не автоматический доступ.
4. **Существующие комнаты без владельца архивирует оператор, а не открывает их.**
   `pnpm db:orphans --list` показывает список, `pnpm db:orphans --archive --yes` архивирует
   каждую с записью в аудит. `pnpm db:orphans --assign <room> --user <email>` — исключение,
   когда владелец действительно известен: берётся личная организация человека, а если её
   нет — самая ранняя активная, и самая ранняя команда в ней; команда создаётся при
   необходимости, действие попадает в аудит. Архивированная комната не лежит ни в чьей
   корзине: добраться до неё можно только claim-маршрутом.
5. **Claim по токену** остаётся поддержанным: колонка `boards.claim_token_hash` и проверка
   в `claimBoard` есть; при `claim_token_hash is null` токен не требуется. Отдельная
   доставка токена появится, когда будет сценарий «комната создана без аккаунта».

## 10. Аудит и приватность

- `audit_events` — append-only (у роли приложения нет `UPDATE/DELETE`); 365 дней,
  затем партиции удаляются заданием.
- Пишем: вход/выход, создание/удаление/передачу комнаты, изменения grants, роли, suspend и
  restore, claim, приём приглашения, отклонённые попытки записи в read-only.
- Правки документа через сокет — одна агрегированная запись `board.document.edited` на
  сессию за окно (60 с по умолчанию, ADR-175): число обновлений, байтов и объектов и
  затронутые поля, без текста и содержимого. Окно без правок не пишет ничего.
- PII: `actor_id` + снимок email на момент действия. Удаление пользователя псевдонимизирует
  `users`, но не переписывает историю (легальный интерес); по запросу на удаление
  достаточно обнулить `users.email`/`name` — аудит остаётся обезличенным.
- Content Admin (доступ к приватным комнатам) **вне v1** именно из-за приватности.

## 11. Приёмочные критерии (нормативные)

| ID | Given / When | Then |
|---|---|---|
| IAM-01 | Приватная комната, пользователь без грантов | `GET /boards/{id}` → 404, содержимое не раскрыто |
| IAM-02 | То же, прямое соединение к `/sync?room=` | соединение закрыто 4404, документ не отправлен |
| IAM-03 | viewer подключён, шлёт Yjs update | сервер отбрасывает update, документ на сервере не меняется, метрика растёт |
| IAM-04 | editor получает grant viewer одновременно с записью | после мутации `acl_version` вырос, соединение закрыто/понижено, дальнейшие апдейты не принимаются |
| IAM-05 | org_admin без грантов открывает приватную комнату | 404; роль администратора доступ не даёт |
| IAM-06 | Владелец передаёт комнату участнику команды | ровно один owner; бывший владелец — editor; одна транзакция |
| IAM-07 | co-owner пытается удалить комнату или передать владение | 403 `OWNER_REQUIRED` |
| IAM-08 | Последнего org_admin понижают | 409 `LAST_ADMIN` |
| IAM-09 | Гость открывает комнату B, на которую нет гранта | 404; список участников и autocomplete не раскрывают чужих |
| IAM-10 | Приглашение принято другим email | 422 `EMAIL_MISMATCH`, доступ не выдан |
| IAM-11 | Приглашение истекло/отозвано/принято повторно | 410, новых прав нет |
| IAM-12 | Публичная ссылка включена, затем ротирована | старый токен не работает; активные read-only соединения закрыты |
| IAM-13 | Снят прямой grant, но есть team grant | доступ сохраняется, ответ перечисляет источник |
| IAM-14 | org membership suspended | `/sync` и API закрыты, включая прямые grants |
| IAM-15 | комната без владельца, claim с неверным токеном | 403 `CLAIM_REJECTED`; повтор после успеха → 409 `ALREADY_CLAIMED` |
| IAM-16 | claim выполнен | заявитель owner, комната в его личной org/team, остальные — только по приглашению |
| IAM-17 | подмена `org_id`/`board_id` в пути | 404, чужой tenant не раскрыт |
| IAM-18 | повтор мутации с тем же `Idempotency-Key` | результат воспроизводим, дублей нет |
| IAM-19 | read-only клиент переподключается | снова read-only; попытки записи логируются |
| IAM-20 | удаление пользователя | сессии отозваны, комнаты требуют передачи, аудит обезличен |
| IAM-32 | участник открывает экран организации | видит список людей; гостей и админ-действий нет; журнала нет |
| IAM-33 | гость открывает экран организации | видит только своё место («вы гость»), список людей недоступен (404) |
| IAM-34 | админ назначает и снимает админ-роли | роли независимы, видны бейджами, каждое действие в журнале |
| IAM-35 | админ приостанавливает и восстанавливает участника | сессия не отзывается; комнаты этой организации и сокеты закрыты, после restore та же сессия снова работает |
| IAM-36 | админ удаляет владельца комнаты | 409 `OWNER_TRANSFER_REQUIRED` со списком комнат и подсказкой |
| IAM-37 | владелец передаёт комнату из «Поделиться» | новый owner, бывший — editor, диалог закрывается |
| IAM-38 | журнал открыт админом | действие, актор, комната и время человекочитаемы |
| IAM-39 | комнату без владельца открывает любой пользователь | доступ и сокет отклоняют, содержимое не отдаётся; `GET /boards/{id}/access` сообщает `UNCLAIMED`; работает только claim |
| IAM-40 | оператор запускает `db:orphans` | `--list` ничего не меняет; `--archive --yes` ставит архив и пишет аудит; `--assign` назначает известного владельца |

## 12. Этапы

| Этап | Состав | Готово, когда |
|---|---|---|
| **P1. Фундамент** | схема + миграции, регистрация/вход/сессии, org/team/room CRUD, `effective()` + explain, аудит, claim, HTTP-enforcement, отказ на WebSocket-хендшейке | **сделано (API)**: IAM-01, 05, 15–17; UI входа/claim — в P2 |
| **P2. Доступ и синк** | grants API + диалог «Поделиться», публичная ссылка, WS-аутентификация, read-only, отзыв, экран «нет доступа», закрытая комната и claim | **сделано**: IAM-02–04, 09, 12–14, 19 |
| **P3. Членство** | приглашения ссылкой (member/guest), принятие, suspend/restore, offboarding с передачей комнат, last-admin, аудит-API | **сделано**: IAM-06–08, 10–11, 18, 20 |
| **P3.1. Экраны организации** | один диалог «Люди/Журнал», роли-чекбоксы, приглашение ссылкой, suspend/restore/удаление, передача владения в «Поделиться», имена в grants и журнале | **сделано**: IAM-32…38 |
| **P4. Вне v1** | email + magic-link + сброс пароля, SCIM, SAML/JIT, группы, Spaces, AccessRequest, service accounts, content_admin, SLO 10 с, политики как код | — |

## 13. Вне объёма v1 (осознанно)

- SAML/SCIM/JIT — требуют IdP-тенанта и поддержки; отдельный проект.
- Email-доставка, magic-link, сброс пароля — нужна почтовая инфраструктура.
- Spaces, вложенные команды, discovery/access requests.
- Биллинг, квоты, гостевые лимиты.
- `content_admin` (доступ к приватным комнатам) — этическое решение + уведомление владельца.
- Политики как код (Rego/CEL), explain-API для внешних потребителей.
- Отзыв ≤10 с (pub/sub), мультирегион, KMS, WORM-аудит, DR.

## 14. Модель угроз (STRIDE, только то, что есть в v1)

| Угроза | Сценарий | Мера |
|---|---|---|
| Spoofing | украденная cookie сессии | httpOnly + Secure, 30-дневная ротация при входе, отзыв сессий, rate limit |
| Spoofing | подделка claim-токена | токен хэшируется; неверный → 403 `CLAIM_REJECTED`, повтор → 409 `ALREADY_CLAIMED` |
| Tampering | viewer пишет в Yjs | сервер отбрасывает update-сообщения, метрика и аудит попыток |
| Tampering | CSRF на мутации | SameSite=Lax + Origin + double-submit токен |
| Repudiation | «я не выдавал доступ» | append-only аудит с actor, before/after, request_id |
| Information disclosure | IDOR по `board_id`/`org_id` | tenant-scoped запросы, 404 вместо 403 для чужого |
| Information disclosure | публичная ссылка утекает | выключение/ротация, предупреждение в UI, ссылка только viewer |
| Denial of service | перебор пароля | rate limit 10/15 мин на ip+email, задержка ответа |
| Elevation of privilege | админ без гранта открывает комнату | capability-функция, `sources`, тест IAM-05 |
| Elevation of privilege | гость получает team grant | гость не имеет `team_memberships`; тест IAM-09 |
| Elevation of privilege | параллельное снятие последнего админа | транзакция + `SELECT … FOR UPDATE`, 409 `LAST_ADMIN` |
| Replay | повтор mutation | `Idempotency-Key`, `If-Match: acl_version` |

Вне модели v1: компрометация IdP (SSO нет), подмена TLS (терминация — инфраструктура),
атаки на сам Postgres, supply chain зависимостей.

## 15. Как проверяем

| Слой | Что | Инструмент |
|---|---|---|
| Модульные | `effective()`: все источники, deny-overrides, `sources`, fail-closed | vitest, чистые функции |
| API | коды, tenant isolation, идемпотентность, last-admin | vitest + fetch к тестовому серверу |
| Сокет | handshake, read-only отбрасывает update, закрытие при отзыве | два WS-клиента на тестовой комнате |
| Миграция | claim: успех, повтор, неверный токен, закрытая комната; архивирование оператором | интеграционный тест на пустой БД |
| Ручные | диалог «Поделиться», приглашение, закрытая комната и claim | TESTING.md, шаги IAM-1…IAM-12 |

Числа для CI: `effective()` — 1000 вызовов < 50 мс; handshake — p95 < 50 мс;
отзыв на активном соединении — измеряется тестом, порог 30 с из §7.

## 16. Что остаётся открытым (решаем по ходу)

1. ~~Несколько активных организаций в UI v1~~ — решено ADR-166/168: переключатель и домашняя страница.
2. Нужен ли `security_admin` в v1, если SSO/политик ещё нет? (сейчас: только аудит)
3. Формат хранения IP в сессиях (приватность) — хранить хэш?
4. Показывать ли гостю название организации, к которой относится комната.

## 14. AI-агенты (v1)

Агенты не меняют `effective()` и не получают грантов: это отдельные принципалы,
которыми владеет человек. Полномочия выдаёт **задача** на одну комнату, а
`agentEffective()` умеет только сузить права владельца. Подробно —
`spec/AI-agents-v1.md`, решение — ADR-066. Для IAM важно:

- агент не является seat, гостем или участником команды;
- включение тройное (организация, комната, агент) и по умолчанию выключено;
- `board.share`, `board.manage`, `board.transfer`, `board.delete` агенту запрещены
  всегда;
- отключение агента, потеря места владельцем или запрет на комнате отменяют очередь и
  закрывают доступ к следующей задаче; запись проверяется повторно перед применением.
