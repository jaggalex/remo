# Платёжные сервисы: подключение, настройка, отключение

ТЗ к **ADR-248**. Статус: предложено, 2026-11-20. Читать вместе с `spec/billing.md` (ADR-247):
биллинг решает, что и когда списать, а этот документ — как говорить с конкретным
платёжным сервисом.

## 0. Зачем

Платёжных сервисов будет несколько, и они будут меняться:

- **ЮKassa** — карты российских банков, СБП, чеки 54-ФЗ. Это первое подключение.
- **Robokassa или Prodamus** — иностранные карты на российское ИП.
- **CloudPayments** — запасной вариант для России.
- **Paddle** — для европейской установки, после регистрации зарубежного юрлица.
- **Ручная оплата** — оплата по счёту для юрлиц.

Цель: добавить, настроить, проверить, приостановить или вывести сервис **без изменения кода
биллинга** и без потери уже оплаченных подписок.

## 1. Правила

1. **Биллинг не знает названий сервисов.** Весь код, специфичный для сервиса, живёт в
   адаптере `apps/sync/pay-<provider>.mjs`. Биллинг работает только с нормализованными
   объектами §4.
2. **Подключение — уровень установки, не организации.** Организации не подключают свои кассы.
3. **Секреты подключения только в зашифрованном виде.** Ключи API запечатаны KEK (`encryptSecret`).
   Наружу отдаётся только отпечаток (`fingerprintSecret`). В логах их нет.
4. **Ничего не удаляется.** Подключение, через которое прошёл хоть один платёж, нельзя
   удалить: только вывести из работы (§2).
5. **Вебхуку не верим на слово.** Каждое входящее событие проверяется способом, который
   предписывает сервис (подпись, IP, повторный запрос статуса через API), и только потом
   влияет на деньги.
6. **Сначала записать, потом обработать.** Вебхук сохраняется во входящий журнал и получает
   ответ «принято», а обрабатывается дренажом. Падение обработки не теряет событие.
7. **Карты хранит сервис, а не мы.**
   - Адаптер поддерживает только сценарии, где карту вводят на странице или в виджете
     сервиса (redirect, iframe, виджет): номер карты не проходит через наши серверы.
   - Сценарии, где наш сервер принимает номер карты или криптограмму (server-to-server
     card API), запрещены.
   - Для повторных списаний адаптер получает от сервиса ссылку на сохранённый им способ
     оплаты (`methodRef`) и только её передаёт биллингу.

## 2. Жизненный цикл подключения

```
 draft ──verify ok──▶ ready ──activate──▶ active ──pause──▶ paused
   ▲                    │                   │  ▲              │
   └── edit config ─────┘                   │  └──resume──────┘
                                            ▼
                                        retiring ──(no live subscriptions)──▶ disabled
```

| Состояние | Новые покупки | Продления | Возвраты | Вебхуки | Когда |
|---|---|---|---|---|---|
| `draft` | нет | нет | нет | нет | создано, настраивается |
| `ready` | нет | нет | нет | да | проверка §2.2 пройдена |
| `active` | да | да | да | да | работает |
| `paused` | нет | да | да | да | временно не принимает новых, например на время разбирательства с сервисом |
| `retiring` | нет | да* | да | да | выводится; подписки переводятся на другое подключение |
| `disabled` | нет | нет | да** | да | выведено; запись остаётся навсегда |

\* В `retiring` продление идёт, но в письме о продлении и в интерфейсе владельцу предлагают
сменить способ оплаты. За 14 дней до продления по подключению в `retiring` уходит письмо
`payment_method_migrate`. Сохранённые карты нельзя перенести между сервисами: карта хранится у
сервиса, поэтому плательщик один раз вводит её заново.

\*\* Возвраты и вебхуки (например, о чарджбэке) принимаются 180 дней после отключения, если
сервис их поддерживает.

Каждый переход записывается в `payment_connection_events` с автором и причиной.

### 2.1 Режимы: тестовый и боевой

`mode` — `test` или `live`. Это свойство подключения, а не флаг на лету: тестовая и боевая
ЮKassa — два разных подключения с разными ключами.
- Организация с `billing_accounts.test_mode = true` маршрутизируется только в тестовые
  подключения, остальные — только в боевые.
- Перевод подключения из `test` в `live` невозможен. Создаётся новое боевое подключение.

### 2.2 Проверка перед включением (`verify`)

Подключение переходит из `draft` в `ready`, только если адаптер прошёл все проверки:

1. `validateConfig` — все обязательные поля есть и в правильном формате.
2. `healthCheck` — запрос к API сервиса с этими ключами успешен. Например, у ЮKassa —
   информация о магазине, у CloudPayments — `test`/ping-метод.
3. **Вебхук:** адрес `https://<REMO_APP_ORIGIN>/billing/webhooks/<connectionId>/<token>` доступен
   снаружи. Если сервис умеет отправлять тестовое уведомление, оно получено и прошло
   проверку подлинности. Если не умеет, оператор отмечает шаг вручную после тестового
   платежа.
4. Для `live`: в тестовой организации проведён и возвращён один платёж на минимальную сумму
   (`pnpm billing:providers smoke <id>`). Результат записывается.

## 3. Модель

### 3.1 Таблицы (глобальные, вне tenant-RLS)

```sql
create table if not exists payment_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('manual','yookassa','robokassa','cloudpayments','prodamus','paddle','fake')),
  name text not null,                    -- "ЮKassa боевая", shown to the operator only
  mode text not null check (mode in ('test','live')),
  status text not null default 'draft'
    check (status in ('draft','ready','active','paused','retiring','disabled')),
  currencies text[] not null,            -- what it can charge, e.g. {RUB}
  method_groups text[] not null,         -- ru_card | foreign_card | invoice | global_card
  priority integer not null default 100, -- lower wins inside a method group
  settings jsonb not null default '{}',  -- non-secret: shop id, tax system, vat code, receipt on/off
  -- secret config (API keys, passwords), sealed with the KEK envelope; column names as
  -- encryptSecret returns them and decryptSecret reads them
  ciphertext bytea, nonce bytea, dek_wrapped bytea,
  dek_nonce bytea, kek_id text, fingerprint text,
  webhook_token text not null,           -- random; required in the webhook URL, wrong or missing → 404
  verified_at timestamptz,
  last_health_at timestamptz, last_health_error text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_connection_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references payment_connections (id),
  type text not null,                    -- created | config_changed | verified | status_changed | secret_rotated
  from_status text, to_status text,
  reason text,
  actor_id uuid references users (id),
  occurred_at timestamptz not null default now()
);

-- Inbound provider events: the inbox. One row per verified delivery.
create table if not exists billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references payment_connections (id),
  provider_event_key text not null,      -- provider's event id, or a derived key (§5)
  type text not null,                    -- normalized type, §4
  org_id uuid,                           -- resolved during processing
  payload jsonb not null,                -- normalized object only, no card data
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  dead_at timestamptz,
  last_error text,
  unique (connection_id, provider_event_key)
);
```

Строки `billing_provider_events` старше 400 дней удаляются (дольше срока чарджбэков).

AAD строится из `scope`, `scope_id`, `provider`, `id`; для подключения это
`scope: "connection"`, `scope_id: id`, `provider: <provider>`, `id: id`. Строка вскрывается
только через эту сборку, второго способа нет.

### 3.2 Две модели подписки

Адаптер заявляет одну:

- **`merchant_scheduled`** (ЮKassa, Robokassa, CloudPayments через токен, `manual`). Сервис
  только проводит разовые списания по сохранённому токену. Продлениями управляет биллинг
  (`spec/billing.md` §3.3).
- **`provider_managed`** (Paddle). Подписку ведёт сервис: он списывает, повторяет и считает
  налоги. Биллинг зеркалит его события в свои `subscriptions` и `payments`. Смена тарифа и
  отмена идут вызовами адаптера.

CloudPayments умеет и собственные подписки. Используем только списание по токену, чтобы
поведение продления было одинаковым для всех российских подключений.

### 3.3 Маршрутизация

`routeFor({ methodGroup, currency, testMode })`:
1. Берёт подключения в статусе `active`, где `mode` соответствует `testMode`, `currencies`
   содержит валюту, `method_groups` содержит группу.
2. Выбирает с наименьшим `priority`.
3. Если подходящих нет — `422 NO_PAYMENT_ROUTE`, а интерфейс эту группу не показывает:
   `GET /billing/catalog` отдаёт доступные группы.

Валюта в маршрутизации — это валюта организации (`billing_accounts.currency`,
`spec/billing.md` §2.1.1). Поэтому выбор валюты сразу ограничивает список способов оплаты, а
валюта без подключений не предлагается вовсе.

Продление всегда идёт через подключение, где сохранён способ оплаты, даже если оно уже не
самое приоритетное.

Группы для старта:

| Группа | Подключение | Комментарий |
|---|---|---|
| `ru_card` | ЮKassa | карты РФ, СБП, SberPay, T-Pay — что включено в магазине |
| `foreign_card` | Robokassa | иностранные карты на российское ИП; комиссия выше |
| `invoice` | manual | оплата по счёту, подтверждает оператор |
| `global_card` | Paddle (позже) | для европейской установки |

## 4. Интерфейс адаптера

```ts
interface PaymentAdapter {
  provider: string;
  capabilities: {
    model: "merchant_scheduled" | "provider_managed";
    saveMethod: boolean;          // can return a reusable token
    verifyMethodWithoutCharge: boolean; // or needs a hold-and-cancel
    refunds: "full" | "partial" | "none";
    receipts54fz: boolean;
    listPayments: boolean;        // supports reconciliation
    currencies: string[];
  };
  configSchema: { public: Field[]; secret: Field[] };   // drives CLI and console forms

  validateConfig(settings, secret): Problem[];
  healthCheck(conn): Promise<{ ok: boolean; detail?: string }>;

  createCheckout(conn, req: {
    paymentId: string; idempotencyKey: string;
    amount: number; currency: string; description: string;
    savePaymentMethod: boolean; customerEmail: string;
    receipt?: Receipt; returnUrl: string; locale: "ru" | "en";
  }): Promise<{ providerPaymentId: string; redirectUrl?: string; widget?: object }>;

  chargeSaved(conn, req: {
    paymentId: string; idempotencyKey: string; methodRef: string;
    amount: number; currency: string; description: string; receipt?: Receipt;
  }): Promise<NormalizedPayment>;

  getPayment(conn, providerPaymentId): Promise<NormalizedPayment>;

  refund(conn, req: { refundId: string; idempotencyKey: string;
    providerPaymentId: string; amount: number; currency: string; receipt?: Receipt;
  }): Promise<NormalizedRefund>;

  parseWebhook(conn, req: { headers: Record<string,string>; rawBody: Buffer; remoteIp: string })
    : Promise<{ verified: boolean; events: NormalizedEvent[];
                respond: { status: number; body: string; contentType?: string } }>;

  listPaymentsSince?(conn, since: Date): Promise<NormalizedPayment[]>;

  // provider_managed only
  changeSubscription?(conn, req): Promise<void>;
  cancelSubscription?(conn, req): Promise<void>;
}
```

**Нормализованные объекты.**

```ts
type NormalizedPayment = {
  providerPaymentId: string;
  status: "pending" | "succeeded" | "failed" | "canceled";
  amount: number; currency: string;
  failureCode?: FailureCode;
  savedMethod?: { methodRef: string; display: { kind: "card" | "sbp" | "wallet";
                  brand?: string; last4?: string; expMonth?: number; expYear?: number } };
  receiptStatus?: "pending" | "issued" | "failed";
  raw?: never;                     // raw provider objects never leave the adapter
};
type NormalizedEvent =
  | { type: "payment.updated"; key: string; payment: NormalizedPayment; paymentId?: string }
  | { type: "refund.updated"; key: string; refund: NormalizedRefund }
  | { type: "method.revoked"; key: string; methodRef: string }
  | { type: "chargeback.opened"; key: string; providerPaymentId: string; amount: number }
  | { type: "subscription.updated"; key: string; subscription: ProviderSubscription };
```

`paymentId` — наш id. Адаптер передаёт его сервису в метаданных (`metadata` у ЮKassa,
`InvoiceId`/`Shp_` у Robokassa, `JsonData` у CloudPayments, `custom_data` у Paddle) и читает
обратно.

**`FailureCode`** — закрытый список:
- `insufficient_funds`, `card_expired`, `card_declined`, `3ds_failed`, `fraud_suspected`,
  `method_revoked`, `limit_exceeded`, `provider_error`, `unknown`;
- для каждого флаг «стоит ли повторять».

Адаптер переводит коды сервиса в этот список по таблице в своём файле. Биллинг показывает
пользователю текст по нормализованному коду, а не текст сервиса.

## 5. Приём вебхуков

`POST /billing/webhooks/:connectionId/:token`:

1. Найти подключение. Неизвестный id → `404`. Неверный или отсутствующий токен → `404`, как
   неизвестное подключение. Подключение в `draft` → `404`.
2. Прочитать **сырое тело** (до 64 КиБ) и не парсить его до проверки. Сырое тело читает новый
   потоковый ридер (рядом с `http-body.mjs`), предел 64 КиБ, байты не парсятся до проверки
   подписи. Пере-сериализованный JSON не годится: подпись CloudPayments/Paddle считается по
   исходным байтам.
3. `adapter.parseWebhook(...)`. `verified: false` → ответ `401`, запись в лог с id
   подключения и IP, метрика `remo_billing_webhook_rejected_total{connection}`.
4. Каждое событие вставить в `billing_provider_events`
   (`on conflict (connection_id, provider_event_key) do nothing`).
5. Вернуть `respond` адаптера: у Robokassa тело ответа должно быть `OK{InvId}`, остальные
   сервисы ждут `200`.

Дренаж `billing-inbox` идёт через общий каркас дренажа (тот же, что у событий и почты),
интервал 2 с, пачка 10, повторы по общей `backoffMs`, после 8 попыток `dead_at`.
Обрабатывает строки:
- найти платёж по `paymentId` или `(connection_id, provider_payment_id)`;
- применить к нему переход статуса **только вперёд** (`pending → succeeded`, но не наоборот);
- выполнить последствия в биллинге (`spec/billing.md`): открыть период, записать
  `billing_events`, поставить письмо в очередь;
- повторы по общей функции `backoffMs`, после 8 попыток — `dead_at` и алерт.

**Проверка подлинности по сервисам** (сверить с актуальной документацией при реализации
адаптера и записать ссылку в шапке файла адаптера):

| Сервис | Как проверяем | `provider_event_key` |
|---|---|---|
| ЮKassa | IP отправителя из опубликованного списка (за прокси — из `X-Forwarded-For` при `REMO_TRUST_PROXY=1`) **и** повторный `GET` объекта через API: верим статусу из ответа API, а не из тела уведомления | `{event}:{object.id}:{status}` |
| CloudPayments | HMAC-SHA256 сырого тела секретом API, заголовок `Content-HMAC` (base64), сравнение постоянного времени | `{type}:{TransactionId}` |
| Robokassa | `SignatureValue` по формуле сервиса с паролем №2, включая `Shp_`-параметры в алфавитном порядке; сумма и `InvId` сверяются с нашим платежом | `result:{InvId}` |
| Paddle | заголовок `Paddle-Signature` (`ts`, `h1`) — HMAC-SHA256 от `ts:rawBody` секретом уведомлений; отклонять старше 5 минут | `event_id` |
| manual | вебхуков нет; события создаёт оператор командой | `manual:{uuid}` |

ЮKassa доставляет уведомления повторно, пока не получит `200`. Поэтому ответ `200` даётся
сразу после записи во входящий журнал, а не после обработки.

### 5.1 Сверка (reconciliation)

Задача `billing-reconcile` раз в час:
- для каждого платежа `pending` старше 15 минут вызывает `getPayment` и, если статус
  изменился, создаёт событие с ключом `reconcile:{paymentId}:{status}`;
- для адаптеров с `listPayments` сравнивает платежи сервиса за 48 часов с нашими;
- платёж у сервиса, которого нет у нас, — алерт оператору (`billing.orphan_payment`), без
  автоматических действий.

## 6. Управление подключениями

### 6.1 Оператор установки

Новая глобальная роль — **оператор** (`instance_operators`: `user_id`, `granted_at`,
`granted_by`). `instance_operators` — отдельная глобальная таблица, вне tenant-RLS и вне
`admin_roles`; роль не даёт доступа к содержимому комнат.
- Выдаётся только командой на сервере: `pnpm operator:grant --email <адрес>`. Через
  интерфейс её не получить.
- Оператор не видит содержимого комнат организаций: это роль для денег и подключений, не
  `content_admin`.

### 6.2 CLI (этап 1, обязателен)

```
pnpm billing:providers list
pnpm billing:providers create --provider yookassa --mode test --name "ЮKassa тест" \
     --currency RUB --groups ru_card            # asks for secret fields interactively
pnpm billing:providers set <id> --priority 10 --settings vat_code=1,tax_system_code=2
pnpm billing:providers secret <id>              # rotate: asks for new values, re-verifies
pnpm billing:providers verify <id>
pnpm billing:providers smoke <id> --org <testOrgId>
pnpm billing:providers activate|pause|resume|retire|disable <id> --reason "..."
pnpm billing:providers webhook-url <id>         # prints the URL to paste into the provider
```

- Секреты вводятся интерактивно или из файла (`--secret-file`), но никогда аргументом
  командной строки: иначе они останутся в истории оболочки.
- `disable` отказывает, пока на подключении есть живые подписки, и выводит их список.

### 6.3 Операторская консоль (этап 2)

Страница `/operator` в приложении, видна только операторам. Повторяет CLI:
- список подключений со статусом, здоровьем, числом подписок и последним вебхуком;
- формы по `configSchema` адаптера (секретные поля только на запись, видно отпечаток);
- переходы статусов с обязательной причиной;
- журнал `payment_connection_events`;
- мёртвые события входящего журнала с кнопкой «Повторить»;
- возвраты (`spec/billing.md` §4.3);
- назначение тарифа вручную;
- кредит.

API под неё — `/operator/billing/...`, только для операторов, с аудитом каждого вызова.

## 7. Адаптеры: что реализовать в каждом

**`pay-manual.mjs`:**
- `createCheckout` создаёт счёт со статусом `open` и возвращает страницу с реквизитами
  (из `settings`) и номером счёта.
- Оплату подтверждает оператор: `pnpm billing:mark-paid <invoice> --amount ... --ref ...`.
- Сохранения способа оплаты нет: продление выставляет новый счёт и отправляет письмо.

**`pay-yookassa.mjs`:**
- Платёж: `POST /v3/payments` с `Idempotence-Key`, `capture: true`, `confirmation.type =
  redirect`, `metadata.paymentId`.
- При покупке подписки — `save_payment_method: true`. Продление — платёж с
  `payment_method_id`.
- Автосписания у ЮKassa включаются по заявке: до запуска согласовать с менеджером и
  поддержкой ЮKassa.
- Чек — объект `receipt` в запросе платежа и возврата. Ставка НДС и система
  налогообложения — из `settings`.
- Возврат: `POST /v3/refunds` с `Idempotence-Key`.
- Отзыв способа оплаты: уведомление о деактивации способа оплаты, если включено, иначе
  отказ `method_revoked` при следующем списании.
- Проверка карты без списания — платёж на 1 ₽ с `capture: false` и последующей отменой.
- `listPayments`: `GET /v3/payments` с фильтром по времени создания.

**`pay-robokassa.mjs`:**
- Ссылка оплаты с `SignatureValue` по паролю №1, `Shp_paymentId`, `Recurring=true` при
  покупке подписки.
- Продление — повторный платёж с `PreviousInvoiceID` (рекуррентные платежи включаются по
  заявке в Robokassa).
- Результат — `ResultURL` с проверкой по паролю №2, ответ `OK{InvId}`.
- Robokassa не шлёт уведомлений о неуспешных платежах. Поэтому неудачи продления узнаются
  через сверку (`OpState` / статус операции): адаптер обязан реализовать `getPayment`.
- Чеки — через фискализацию Robokassa (`Receipt` в запросе), если включена.
- Возвраты — через API возвратов Robokassa, если доступны магазину. Иначе
  `capabilities.refunds = "none"`, и оператор делает возврат в кабинете, а затем отмечает его
  командой.

**`pay-cloudpayments.mjs`** (если понадобится):
- Виджет или ссылка оплаты с `AccountId`, `InvoiceId`, `JsonData.paymentId`.
- Токен приходит в уведомлении `Pay`. Продление — оплата по токену.
- Уведомления `Check`/`Pay`/`Fail`/`Refund` с проверкой `Content-HMAC`.

**`pay-paddle.mjs`** (позже, `provider_managed`):
- Checkout с `custom_data.orgId`. Подписка и цены живут в Paddle и связаны с нашими
  `price_id` через `settings`.
- События `subscription.*` и `transaction.*` зеркалятся. Paddle — продавец (merchant of
  record), поэтому чеки и налоги на нём, `receipt` не передаём.

**`pay-fake.mjs`** (только для тестов и разработки):
- Ведёт себя как `merchant_scheduled`-сервис: страница оплаты с кнопками «Успех», «Отказ»,
  «3DS не пройден».
- Вебхук с HMAC; управляемые задержки и дубли уведомлений.
- Загружается только при `NODE_ENV !== "production"` и явном флаге `REMO_PAY_FAKE=1`; в
  production процесс не стартует — та же проверка, что у `ai-fake.mjs`.

## 8. Тесты

- **Контрактный набор** `pay-adapter.contract.test.mjs`: один набор тестов прогоняется на
  каждом адаптере с поддельным HTTP.
  - `createCheckout` передаёт `paymentId` и ключ идемпотентности;
  - `parseWebhook` принимает правильно подписанное и отклоняет подделку, повтор и чужое
    подключение;
  - коды ошибок нормализуются;
  - `getPayment` переводит статусы;
  - секреты не попадают в выброшенные ошибки и в лог.
- **ЮKassa:** уведомление с чужого IP отвергается; уведомление с верного IP, но со статусом,
  которого API не подтверждает, не меняет платёж.
- **Robokassa:** формула подписи с `Shp_`-параметрами; ответ `OK{InvId}`; неудачное продление
  находится сверкой.
- **Жизненный цикл:**
  - все переходы §2 и запрещённые переходы;
  - `disable` при живых подписках отказывает;
  - `retiring` шлёт `payment_method_migrate`.
- **Маршрутизация:** таблица случаев `routeFor`, включая тестовый режим.
- **Входящий журнал:** дубль вебхука не даёт второго события; обработка «только вперёд»;
  падение обработки ведёт к повтору, а не к потере.
- **Сквозной сценарий** на `pay-fake` (используется и в `spec/billing.md` §11).

## 9. Этапы

1. Таблицы, `instance_operators`, CLI §6.2, адаптеры `manual` и `fake`, входящий журнал,
   маршрутизация, контрактный набор. Вместе с этапом 2 биллинга.
2. Адаптер ЮKassa, проверка §2.2 на тестовом магазине, сверка. Вместе с этапом 3 биллинга.
3. Операторская консоль §6.3.
4. Адаптер Robokassa (или Prodamus, если условия окажутся лучше).
5. Paddle — отдельным решением после регистрации зарубежного юрлица.

## 10. Приёмка

1. Тестовое подключение ЮKassa проходит `create → verify → activate → smoke` без правки кода.
   Пауза останавливает новые покупки и не останавливает продления.
2. Повторная отправка всех вебхуков ЮKassa за тестовый день не меняет ни одного платежа.
   Подделанный вебхук (верное тело, чужой IP) отклонён и виден в метрике.
3. Вывод подключения: `retire` → письмо о смене способа оплаты → плательщик вводит карту
   через другое подключение → `disable` проходит, потому что живых подписок не осталось.
4. Контрактный набор зелёный для каждого реализованного адаптера.
5. Поиск по логам и базе не находит ни одного ключа API в открытом виде.

## 11. Решения за владельцем продукта

- Какой сервис для иностранных карт: Robokassa или Prodamus (сравнить договорные комиссии и
  поддержку рекуррентных платежей).
- Нужен ли CloudPayments как резерв к ЮKassa с самого начала.
- Реквизиты для оплаты по счёту и минимальная сумма такого счёта. Решение по умолчанию:
  реквизиты и минимальная сумма — годовая подписка Team и выше.
