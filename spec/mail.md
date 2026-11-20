# Почта: транзакционные письма, сброс пароля и подтверждение адреса

ТЗ к **ADR-246**. Статус: предложено, 2026-11-20. Документ написан для исполнителя (человека
или агента), который будет реализовывать модуль. Прежде чем менять код, прочитайте
`AGENTS.md`, ADR-178 (RLS), ADR-094/095 (outbox и вебхуки), ADR-179 (ссылки приглашений) и
`spec/IAM-v1.md` §6.

## 0. Зачем и что в объёме

Сейчас remo не отправляет писем. Из-за этого:

- забытый пароль означает потерянный аккаунт;
- адрес при регистрации не проверяется;
- ссылку-приглашение владелец копирует и пересылает вручную (`iam-api-invitations.mjs`,
  комментарий «No mail service yet»).

**В объёме:**

1. Почтовый модуль: очередь писем, драйверы `disabled`, `console`, `smtp`, `resend`, шаблоны
   RU/EN, дренаж с повторами.
2. Сброс пароля по ссылке из письма.
3. Подтверждение адреса при регистрации и повторная отправка.
4. Приглашения письмом (ссылку по-прежнему можно скопировать).
5. Уведомление «пароль изменён» после смены и после сброса.
6. Интерфейс для пунктов 2–5, документация, тесты.

**Вне объёма** (отдельные ADR): вход по коду из письма, смена адреса, уведомление о входе с
нового устройства, OAuth (Яндекс ID, VK ID, Google, GitHub), TOTP и passkeys, маркетинговые
рассылки, входящая почта, письма модуля поддержки и биллинга. Модуль должен позволять
добавить их новым шаблоном и новым вызовом `enqueueMail`, без второго механизма.

## 1. Правила, которые нельзя нарушить

1. **Один механизм.** Любое письмо — строка в `mail_outbox`. Ни один маршрут не вызывает
   драйвер напрямую.
2. **Ни одной рабочей ссылки в открытом виде в базе.** Токены хранятся только как SHA-256.
   Параметры письма, содержащие ссылку, запечатаны KEK и стираются после отправки.
3. **Не раскрываем, есть ли аккаунт.** «Забыли пароль» отвечает одинаково для известного и
   неизвестного адреса.
4. **Без почты ничего не ломается.** Если драйвер `disabled`, функции, которым нужна почта,
   выключены и честно об этом говорят. Подтверждение адреса не требуется.
5. **Никакого трекинга.** Ни пикселей открытия, ни переписывания ссылок. У Resend
   отслеживание открытий и кликов на домене выключено.
6. **Адреса и токены не попадают в логи.** В логах только id письма, шаблон и код ошибки.

## 2. Устройство

### 2.1 Файлы

Все файлы лежат в `apps/sync`, плоско, как остальной сервис.

| Файл | Что внутри |
|---|---|
| `mail.mjs` | конфигурация из env, `enqueueMail(store, {...})`, выбор драйвера, `mailCapabilities()` |
| `mail-drivers.mjs` | драйверы `disabled`, `console`, `smtp`, `resend`, класс `MailError` |
| `mail-templates.mjs` | шаблоны: `render(template, locale, params) → { subject, text, html }` |
| `mail-drain.mjs` | `createMailDrain({ store, driver, log, metrics })` по образцу `sync-events.mjs` |
| `auth-tokens.mjs` | создание и проверка токенов сброса и подтверждения |
| `iam-api-recovery.mjs` | маршруты сброса пароля и подтверждения адреса (§5) |
| `pg/mail.mjs` | методы хранилища для `mail_outbox` и `auth_tokens` |
| `backoff.mjs` | общая функция `backoffMs(attempts, schedule)`; `webhookBackoffMs` переходит на неё |
| `scripts/mail-test.mjs` | `pnpm mail:test --to <адрес>` — тестовое письмо через настроенный драйвер |
| `scripts/mail-dead.mjs` | `pnpm mail:dead [--retry <id>]` — список и повтор «мёртвых» писем |

Тесты лежат рядом: `*.test.mjs` — юнит, `*.db.test.mjs` — с тестовой базой.

### 2.2 Драйверы

Контракт у всех драйверов один:

```js
/**
 * @param {{ id: string, to: string, from: string, replyTo?: string,
 *           subject: string, text: string, html: string }} message
 * @returns {Promise<{ providerId: string | null }>}
 * @throws {MailError} code, retryable: boolean
 */
async function send(message) {}
```

`MailError` несёт `code` (строка) и `retryable`. Дренаж решает только по `retryable`.

**`disabled`.** Это значение по умолчанию при `NODE_ENV=production`. `enqueueMail` ничего не
пишет и возвращает `{ queued: false }`. Вызывающий код это учитывает (§5).

**`console`.** Это значение по умолчанию вне production.
- Печатает в stdout строку `[mail] <template> <id> → <ссылка из письма>`, чтобы разработчик
  мог по ней кликнуть. Адрес получателя не печатает.
- Если задан `REMO_MAIL_CONSOLE_FILE`, дописывает туда письмо целиком одной JSON-строкой.
  Так e2e-тесты читают письма. Второго тестового механизма не делаем.
- При `NODE_ENV=production` сервис с этим драйвером не стартует: так случайно не уйдут
  ссылки в логи продакшена.

**`smtp`.**
- Через `nodemailer`. Это новая зависимость `apps/sync`, причина записана в ADR-246.
- Настраивается одной переменной `REMO_SMTP_URL`: `smtps://user:pass@host:465` или
  `smtp://user:pass@host:587`. Для 587 STARTTLS обязателен (`requireTLS: true`).
- `Message-ID` = `<{id}@{домен из REMO_MAIL_FROM}>`.
- Ответы SMTP 4xx и сетевые ошибки — `retryable: true`. Ответы 5xx — `retryable: false`.
- Этот же драйвер обслуживает российский регион: SMTP есть и у Unisender Go, и у Yandex Cloud
  Postbox. Отдельный драйвер под них в этом ТЗ не нужен.

**`resend`.**
- Один вызов `POST https://api.resend.com/emails` через `safeFetch` из `outbound.mjs`. SDK
  не ставим.
- Заголовки: `Authorization: Bearer ${REMO_RESEND_API_KEY}`, `Idempotency-Key: mail/{id}`.
- Тело: `{ from, to: [to], subject, text, html, reply_to? }`.
- Как трактуем ответ:

| Ответ | Результат |
|---|---|
| 2xx | успех, `providerId = body.id` |
| 409 (`concurrent_idempotent_requests`, `invalid_idempotent_request`) | `retryable: true` |
| 429, 5xx, сеть, таймаут (15 с) | `retryable: true` |
| 400, 422 (`validation_error` и т. п.) | `retryable: false` |
| 401, 403 (`invalid_api_key`, `restricted_api_key`) | `retryable: false`, плюс громкая ошибка в лог: это поломка конфигурации, а не одно письмо |

- Регион отправки выбирается при добавлении домена в Resend (`eu-west-1`), а не в API.

### 2.3 Конфигурация

| Переменная | Значение | По умолчанию |
|---|---|---|
| `REMO_MAIL_DRIVER` | `disabled`, `console`, `smtp`, `resend` | `disabled` в production, иначе `console` |
| `REMO_MAIL_FROM` | `remo <no-reply@mail.example.com>` | обязательна для `smtp` и `resend` |
| `REMO_MAIL_REPLY_TO` | адрес для ответов | нет |
| `REMO_MAIL_PRODUCT_NAME` | название продукта в письмах (для self-host) | `remo` |
| `REMO_RESEND_API_KEY` | ключ Resend с правом только на отправку | обязательна для `resend` |
| `REMO_SMTP_URL` | см. §2.2 | обязательна для `smtp` |
| `REMO_MAIL_CONSOLE_FILE` | путь для драйвера `console` | нет |
| `REMO_MAIL_BATCH` | писем за проход дренажа | 10 |
| `REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES` | `0` отключает требование §5.3 | `1` |

**Проверки при старте.** Сервис не стартует, если:
- драйвер `smtp` или `resend` без своих обязательных переменных;
- `REMO_MAIL_FROM` не разбирается как адрес;
- драйвер не `disabled`, а `REMO_KEK` не задан (без него нечем запечатать параметры);
- `console` при `NODE_ENV=production`.

С дисковым хранилищем (без Postgres) почта всегда `disabled`.

Ключ и SMTP-пароль живут только в env, в базу не попадают (правило 7 `AGENTS.md`).

## 3. Данные (schema 21)

`SCHEMA_VERSION` становится 21, изменения идут в `schema.sql` в стиле файла (`if not exists`,
защищённые `alter`).

```sql
alter table users add column if not exists email_verified_at timestamptz;

create table if not exists auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('password_reset', 'email_verify')),
  token_hash bytea not null unique,
  -- the address the token proves; a later change of address voids it
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists auth_tokens_user_idx on auth_tokens (user_id, purpose)
  where used_at is null;

create table if not exists mail_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete cascade,
  to_email text not null,
  template text not null
    check (template in ('verify_email', 'password_reset', 'password_changed', 'invitation')),
  locale text not null check (locale in ('ru', 'en')),
  -- params that are safe in clear text (a name, an org title)
  params jsonb not null default '{}'::jsonb,
  -- params that hold a secret link, sealed with the KEK envelope; cleared once sent or dead
  sealed_ciphertext bytea,
  sealed_nonce bytea,
  sealed_dek_wrapped bytea,
  sealed_dek_nonce bytea,
  sealed_kek_id text,
  -- after this moment the link in the mail is useless: the row dies instead of sending
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  dead_at timestamptz,
  last_error text,
  provider_id text
);
create index if not exists mail_outbox_pending_idx
  on mail_outbox (created_at) where sent_at is null and dead_at is null;
```

**Почему отдельная таблица, а не `event_outbox`.** `event_outbox` привязана к комнате
(`board_id not null`), защищена RLS по организации и по правилу не содержит персональных
данных (`spec/webhooks.md`). Письмо — это глобальная сущность аккаунта с адресом и секретом.
Семантика «забрать, отправить, записать исход» та же, код дренажа повторяет
`sync-events.mjs`.

**RLS.** `mail_outbox` и `auth_tokens` — глобальные таблицы аутентификации, как `users` и
`sessions`. В tenant-RLS не входят. Добавьте их в список «Global identity» в ADR-178 (через
ADR-246, старый текст не переписывать) и в исключения `pnpm db:rls --check`, если инвентарь
их требует.

**Захват пачки.** Функция `remo_claim_mail_batch(batch integer)` устроена как
`remo_claim_event_batch`: `for update skip locked`, аренда `next_attempt_at = now() + 5 min`,
выдача `grant execute` для `remo_app`.

**Запечатывание.** Используйте `encryptSecret` / `decryptSecret` из `secrets.mjs` с
`scope: "user"`, `scopeId: user_id ?? "none"`, `provider: "mail"`, `id: <id письма>`. Id
письма генерируется в коде до вставки, чтобы AAD был известен.

**Хранение.**
- При `sent_at` или `dead_at` колонки `sealed_*` обнуляются в той же транзакции.
- Строки старше 30 дней удаляются. Это делает дренаж раз в час (`delete ... limit 1000`).
- Использованные и просроченные `auth_tokens` старше 7 дней удаляются тем же проходом.

## 4. Дренаж

`createMailDrain` повторяет `createEventDrain`: интервал 2 с, пачка `REMO_MAIL_BATCH`, защита от
параллельного прохода. Запускается в `server.mjs` рядом с дренажом событий, только при
Postgres и драйвере не `disabled`.

Для каждой строки:

1. Если `valid_until < now()`, строка умирает с `last_error = 'EXPIRED'`, не отправляясь.
2. Распечатать `sealed_*`, собрать параметры, `render(template, locale, params)`.
3. `driver.send(...)`.
4. Успех: `sent_at = now()`, `provider_id`, обнулить `sealed_*`, `last_error = null`.
5. `retryable: true`: `attempts + 1`, `next_attempt_at = now() + backoffMs(attempts, MAIL_SCHEDULE)`.
   После `MAIL_MAX_ATTEMPTS` попыток строка умирает.
6. `retryable: false`: строка умирает сразу.

```js
export const MAIL_SCHEDULE = [5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000];
export const MAIL_MAX_ATTEMPTS = 6;
```

Почта короче вебхуков, потому что письма ждёт человек, а ссылка сброса живёт 60 минут.
Функция `backoffMs` общая с вебхуками (`backoff.mjs`). Расписания разные, механизм один.

**Метрики** через `metrics.mjs`:
- `remo_mail_sent_total{template}`;
- `remo_mail_failed_total{template,code}` — каждая неудачная попытка;
- `remo_mail_dead_total{template,code}`;
- `remo_mail_queue_depth` — gauge ожидающих писем, читается при рендере `/metrics`.

**Лог:** `[mail] sent password_reset 0f3c…` и `[mail] retry 2/6 invitation 0f3c… SMTP_421`.
Адресов в логе нет.

## 5. Сценарии и API

Новые маршруты живут в `iam-api-recovery.mjs` и подключаются туда же, где `handleAuthRoutes`.
Мутации проходят обычную проверку CSRF/Origin. Исключения — маршруты без сессии
(`forgot`, `reset`, `verify`): для них нужна только проверка `Origin`, как для `/auth/login`.

### 5.0 Что умеет сервер

`GET /auth/capabilities` → `{ mail: boolean, passwordReset: boolean, emailVerification: boolean }`.
Без сессии. Клиент по ответу решает, показывать ли «Забыли пароль?». Все три флага равны
`mail !== disabled`, но названы раздельно, чтобы позже их можно было развести.

`GET /auth/me` → в `user` добавляется `emailVerified: boolean`.

### 5.1 Забыли пароль

`POST /auth/password/forgot` `{ email }` → всегда `202 { ok: true }`.

Ограничения (`reserveAttempt`):
- `forgot-ip:<ip>` — 10 в час;
- `forgot-email:<email>` — 3 в час.

При превышении ответ всё равно `202` (иначе по 429 можно узнать, что адрес существует), но
письмо не создаётся.

Если адрес принадлежит активному пользователю и почта включена, в одной транзакции:
1. Помечаются использованными все неиспользованные `password_reset` этого пользователя.
2. Создаётся токен: `newToken()` (32 байта), в базу идёт `hashToken`, `expires_at = now() + 60 min`.
3. `enqueueMail` с шаблоном `password_reset`, в запечатанных параметрах ссылка
   `${REMO_APP_ORIGIN}/?reset=<token>`, `valid_until = expires_at`.
4. Пишется аудит `auth.password_reset_requested` (subject — id пользователя, не адрес).

Время ответа не должно зависеть от того, существует ли аккаунт. Вся работа по известному
адресу делается после ответа (`setImmediate`) или занимает те же миллисекунды. Тест
сравнивает медианы.

Если почта выключена, ответ `202`, ничего не происходит. Клиент эту форму всё равно не
покажет (§5.0).

### 5.2 Новый пароль по ссылке

`POST /auth/password/reset` `{ token, newPassword }`.

Ограничение: `reset-ip:<ip>` — 20 попыток за 15 минут.

Ответы:
- `400 TOKEN_INVALID` — токена нет или он уже использован;
- `400 TOKEN_EXPIRED` — токен просрочен;
- `422` — слабый пароль, коды из `passwordProblem`.

Успех, одна транзакция:
1. Обновить `password_hash` (`hashQueue.withSlot(() => hashPassword(...))`).
2. Пометить токен использованным, а заодно все другие `password_reset` пользователя.
3. Отозвать все сессии пользователя (`revokeUserSessions`).
4. Если адрес токена совпадает с текущим, поставить `email_verified_at = coalesce(email_verified_at, now())`:
   владелец ящика доказал адрес.
5. Поставить в очередь письмо `password_changed`.
6. Записать аудит `auth.password_reset`.

Ответ `200 { ok: true }`. **Автоматического входа нет**: клиент открывает форму входа с
подставленным адресом. Если ссылка утекла, по ней можно сменить пароль, но сессию получить
нельзя, а владелец получит уведомление.

Существующий `POST /auth/password` (смена по текущему паролю) после успеха тоже ставит в
очередь `password_changed`.

### 5.3 Подтверждение адреса

**При регистрации** (`/auth/register`), если почта включена: токен `email_verify` с
`expires_at = now() + 24 h` и письмо `verify_email` со ссылкой `${REMO_APP_ORIGIN}/?verify=<token>`.
Ответ регистрации не меняется, только `user.emailVerified: false`.

**`POST /auth/email/verify` `{ token }`.** Сессия не нужна: ссылку часто открывают в другом
браузере.
- Ответы: `400 TOKEN_INVALID`, `400 TOKEN_EXPIRED`, `409 EMAIL_CHANGED` (адрес токена ≠ текущий).
- Успех: `email_verified_at = now()`, токен использован, аудит `auth.email_verified`, `200 { ok: true }`.
- Повторное подтверждение уже подтверждённого адреса отвечает `200`.

**`POST /auth/email/resend`.** Нужна сессия.
- Ограничение `verify-resend:<userId>` — 3 в час. При превышении `429` с `Retry-After`: здесь
  пользователь уже вошёл, раскрывать нечего.
- Старые неиспользованные `email_verify` помечаются использованными, создаётся новый.
- Если адрес уже подтверждён — `200 { ok: true, alreadyVerified: true }`.

**Что запрещено неподтверждённому**, когда почта включена и
`REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES != 0`: создание приглашений (оба маршрута в
`iam-api-invitations.mjs`), ответ `403 EMAIL_NOT_VERIFIED`. Причина: иначе сервис рассылает
письма от имени непроверенного человека. Входить и работать в комнатах неподтверждённый
может. Биллинг добавит своё требование в своём ADR.

**Существующие аккаунты** остаются с `email_verified_at = null` и увидят просьбу подтвердить
адрес. Массово помечать их подтверждёнными нельзя: этого никто не проверял.

### 5.4 Приглашения письмом

В обоих маршрутах создания приглашения (организация и комната) после успешного создания, если
почта включена, ставится письмо `invitation`:
- открытые параметры: имя пригласившего, название организации или комнаты, роль;
- запечатанные: ссылка `inviteUrl(token)`;
- `valid_until = expires_at` приглашения.

Ответ получает поле `emailQueued: boolean`. Поле `url` остаётся: ссылку по-прежнему можно
скопировать.

Название комнаты в письме допустимо: человека приглашают именно в неё. Содержимого комнаты в
письме нет.

Отзыв приглашения письмо не отзывает. Ссылка просто перестанет работать: это уже обеспечено
состоянием `revoked`.

### 5.5 Язык письма

`users.lang` → иначе `Accept-Language` запроса (`ru*` → `ru`) → иначе `en`. Для приглашения
адресата ещё нет, поэтому язык берётся у пригласившего.

## 6. Шаблоны

`mail-templates.mjs` экспортирует `render(template, locale, params)`. Требования:

- Каждое письмо имеет `text` и `html`. `text` — полноценная версия, а не «откройте HTML».
- Все подставляемые значения в `html` экранируются (имя может содержать `<script>`). В `text`
  убираются переводы строк из однострочных полей.
- HTML простой: одна колонка, инлайновые стили, системный шрифт, одна кнопка-ссылка, та же
  ссылка текстом под ней. Внешних картинок и шрифтов нет.
- `{product}` = `REMO_MAIL_PRODUCT_NAME`.
- Тексты ниже нормативны. Менять можно только вместе с этим документом.

**verify_email**
- RU тема: `Подтвердите почту для {product}`
- RU текст: `Здравствуйте, {name}! Подтвердите, что это ваш адрес: {link} Ссылка действует 24 часа. Если вы не регистрировались в {product}, просто удалите это письмо.`
- EN тема: `Confirm your email for {product}`
- EN текст: `Hi {name}, please confirm this is your address: {link} The link works for 24 hours. If you didn't sign up for {product}, you can ignore this email.`

**password_reset**
- RU тема: `Сброс пароля в {product}`
- RU текст: `Кто-то (надеемся, вы) запросил сброс пароля. Задать новый пароль: {link} Ссылка действует 60 минут и сработает один раз. Если это были не вы, ничего не делайте: пароль останется прежним.`
- EN тема: `Reset your {product} password`
- EN текст: `Someone (hopefully you) asked to reset your password. Set a new one: {link} The link works once, for 60 minutes. If it wasn't you, do nothing — your password stays the same.`

**password_changed**
- RU тема: `Пароль в {product} изменён`
- RU текст: `Пароль вашего аккаунта {email} только что изменили, все сеансы завершены. Если это были не вы, сразу сбросьте пароль: {forgotLink}`
- EN тема: `Your {product} password was changed`
- EN текст: `The password for {email} was just changed and all sessions were signed out. If this wasn't you, reset your password now: {forgotLink}`
- `{forgotLink}` = `${REMO_APP_ORIGIN}/?forgot=1`. В нём нет секрета, он лежит в открытых
  параметрах.

**invitation**
- RU тема: `{inviter} приглашает вас в {target}`
- RU текст: `{inviter} приглашает вас в {targetKind} «{target}» в {product}. Принять приглашение: {link} Приглашение действует до {expires}.`
- EN тема: `{inviter} invited you to {target}`
- EN текст: `{inviter} invited you to the {targetKind} "{target}" on {product}. Accept: {link} The invitation is valid until {expires}.`
- `{targetKind}`: «организацию» / «комнату», `organisation` / `room`. `{expires}` — дата в
  локали письма.

## 7. Интерфейс (`apps/web`)

Все строки идут через `apps/web/src/i18n` (ru и en, иначе не пройдёт `tsc`). Цвета и размеры
только из `@remo/ui`.

1. **`AuthDialog`.**
   - Под паролем ссылка «Забыли пароль?», только если `capabilities.passwordReset`.
   - Иначе, при ошибке входа, текст «Восстановить пароль может администратор сервера».
2. **Форма «Забыли пароль».**
   - Поле email, кнопка «Отправить ссылку».
   - После отправки всегда один текст: «Если аккаунт с этим адресом есть, мы отправили письмо
     со ссылкой. Проверьте папку «Спам».»
   - `?forgot=1` открывает эту форму.
3. **`?reset=<token>`** на домашнем маршруте, как `?invite=` (ADR-179).
   - Сразу убрать токен из адресной строки (`history.replaceState`), чтобы он не попал в
     историю и заголовок `Referer`.
   - Диалог: новый пароль, кнопка «Показать», требования к паролю из `passwordProblem`.
   - Успех: «Пароль изменён. Войдите с новым паролем» и форма входа.
   - `TOKEN_EXPIRED` и `TOKEN_INVALID`: понятный текст и кнопка «Запросить новую ссылку».
4. **`?verify=<token>`.** Так же убрать токен из адреса, вызвать `/auth/email/verify` и
   показать тост «Почта подтверждена». Работает с сессией и без неё.
5. **Неподтверждённый адрес.**
   - В меню аккаунта строка «Подтвердите почту», кнопка «Отправить письмо ещё раз».
   - Баннер на домашнем экране, который можно скрыть до следующего входа.
   - На доске баннера нет: он мешает работе.
6. **`InviteDialog` и приглашения в организацию.**
   - Если `emailQueued`, показать «Приглашение отправлено на {email}». Кнопка «Скопировать
     ссылку» остаётся.
   - При `EMAIL_NOT_VERIFIED` показать «Чтобы приглашать людей, подтвердите почту» и кнопку
     повторной отправки.
7. **`Referrer-Policy`** в `deploy/nginx-security-headers.conf` уже `same-origin`: на чужие
   сайты токен не уйдёт. Не ослабляйте этот заголовок.

## 8. Безопасность (чек-лист ревью)

- [ ] Токены: 32 случайных байта, в базе только SHA-256, одноразовые, TTL 60 мин / 24 ч.
- [ ] Новый токен того же назначения гасит старые.
- [ ] `forgot` не раскрывает наличие аккаунта ни кодом, ни временем, ни ограничением частоты.
- [ ] После сброса отозваны все сессии и ушло уведомление.
- [ ] После сброса нет автоматического входа.
- [ ] Параметры со ссылками запечатаны KEK и стёрты после отправки или смерти письма.
- [ ] В логах нет адресов, токенов и ссылок, кроме драйвера `console` вне production.
- [ ] Ссылки строятся только из `REMO_APP_ORIGIN`, никогда из заголовков `Host` или `Origin`
      запроса: иначе возможна подмена ссылки сброса.
- [ ] Значения в HTML-шаблонах экранированы, есть тест с `<script>` в имени.
- [ ] Ключ Resend и SMTP-пароль только в env. `pnpm audit:prod` проходит с `nodemailer`.
- [ ] Токен убирается из адресной строки, `Referrer-Policy: same-origin` сохранён.

## 9. Тесты

**Юнит (`pnpm test`):**
- `mail-templates.test.mjs`:
  - все 4 шаблона × 2 языка дают непустые `subject`, `text`, `html`;
  - ссылка есть и в `text`, и в `html`;
  - экранирование;
  - неизвестный шаблон или язык — ошибка.
- `mail-drivers.test.mjs`:
  - `resend` с поддельным `fetch`: 200, 409, 422, 429, 500, 401, таймаут → ожидаемые
    `retryable` и `code`; заголовок `Idempotency-Key` равен `mail/{id}`;
  - `smtp` с поддельным транспортом: 4xx и 5xx;
  - `console` пишет в файл, и запрещён при production.
- `mail.test.mjs`: проверки конфигурации при старте (каждая строка списка §2.3).
- `mail-drain.test.mjs`:
  - успех;
  - повтор с расписанием;
  - смерть после `MAIL_MAX_ATTEMPTS`;
  - немедленная смерть при `retryable: false`;
  - `EXPIRED` без вызова драйвера;
  - обнуление `sealed_*`.
- `backoff.test.mjs`: `webhookBackoffMs` даёт прежние значения (регресс).

**С базой (`*.db.test.mjs`, `pnpm test:db:up`):**
- схема 21 применяется на чистую базу и на базу схемы 20;
- `remo_claim_mail_batch`: два параллельных захвата не берут одну строку;
- работает от роли `remo_app`;
- маршруты целиком:
  - forgot для известного и неизвестного адреса — одинаковые ответы, письмо только для
    известного;
  - reset — смена пароля, отзыв сессий, токен одноразовый, просроченный отвергается,
    `email_verified_at` выставлен, письмо `password_changed` в очереди;
  - verify и resend с ограничением частоты;
  - приглашение неподтверждённым — `403`;
  - приглашение подтверждённым — `emailQueued: true` и строка `invitation` в очереди;
  - при `disabled` очередь пуста, а `capabilities` равны `false`.
- Тайминг forgot: медианы 30 запросов для известного и неизвестного адреса отличаются не
  больше чем на 20 мс.

**Браузер (`pnpm e2e`)** с `REMO_MAIL_DRIVER=console` и `REMO_MAIL_CONSOLE_FILE`:
1. Регистрация → письмо `verify_email` в файле → переход по ссылке → «Почта подтверждена» →
   баннер исчез.
2. Выход → «Забыли пароль?» → письмо → ссылка → новый пароль → вход с новым паролем;
   старая сессия во второй вкладке разлогинена.
3. Приглашение в комнату → письмо `invitation` → ссылка открывает принятие (ADR-179).

## 10. Документация

| Где | Что |
|---|---|
| `guide/reference/env` (ru, en) | все переменные §2.3 |
| `guide/admin/deploy` | отправка почты: поддомен (`mail.example.com`), SPF, DKIM, DMARC (начать с `p=none`), проверка `pnpm mail:test` |
| `guide/how-to/account` | сброс пароля, подтверждение почты |
| `content/help` | короткая справка в приложении (RU, EN) |
| `docs/self-hosting.md`, `deploy/production.env.example` | переменные, пример для SMTP и Resend |
| `spec/IAM-v1.md` §6, §13 | отметка, что ограничение «нет почты» снято ADR-246 (старый текст не удалять) |
| журнал изменений в `guide/support/changelog` | запись о версии |

После правки документации прогнать `pnpm docs:check` и `pnpm guide:check`.

## 11. Этапы (каждый — отдельный PR, каждый проходит `pnpm verify`)

1. **Основа.**
   - ADR-246 переводится в accepted.
   - Схема 21, `backoff.mjs`, `mail.mjs`, `mail-drivers.mjs`, `mail-templates.mjs`,
     `mail-drain.mjs`, `pg/mail.mjs`.
   - Скрипты `mail:test` и `mail:dead`, метрики.
   - Маршрутов пока нет: письма создаёт только `mail:test`.
2. **Сброс пароля.** `auth-tokens.mjs`, §5.0–5.2, уведомление `password_changed`, тесты.
3. **Подтверждение адреса и приглашения.** §5.3–5.5, тесты.
4. **Интерфейс, документация, e2e.** §7, §10, §9 (браузер).

## 12. Приёмка

Работа принята, когда выполнены все пункты:

1. `pnpm verify --e2e` зелёный.
2. С драйвером `resend` на тестовом домене `pnpm mail:test --to <адрес>` доставляет письмо.
   В интерфейсе Resend у него виден `Idempotency-Key`.
3. С драйвером `smtp` через Unisender Go или Yandex Cloud Postbox `pnpm mail:test` доставляет
   письмо.
4. После остановки сети на 2 минуты письма доходят после её возврата. `remo_mail_dead_total`
   не растёт.
5. `select count(*) from mail_outbox where sent_at is not null and sealed_ciphertext is not null`
   = 0.
6. Поиск по логам сервиса за прогон e2e в режиме production не находит ни адресов, ни `?reset=`.
7. С `REMO_MAIL_DRIVER=disabled` поведение входа, регистрации и приглашений не отличается от
   версии 0.4.1. Не появилось ни одного нового обязательного шага.
8. Пункты чек-листа §8 отмечены в описании PR со ссылками на тесты.

## 13. Решения, которые остаются за владельцем продукта

- Домен отправки (предложение: `mail.<основной домен>`, отдельно для европейского и
  российского регионов).
- Провайдер российского региона: Unisender Go или Yandex Cloud Postbox. На код не влияет,
  оба работают через `smtp`.
- Срок хранения писем (предложено 30 дней) и использованных токенов (7 дней).
- Требовать ли подтверждение адреса до первой работы. Предложено нет: только для приглашений
  и, позже, для оплаты.
