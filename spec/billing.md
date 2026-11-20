# Биллинг: тарифы, права организации, подписки и платежи

ТЗ к **ADR-247**. Статус: предложено, 2026-11-20. Подключение платёжных сервисов — отдельный
документ `spec/payment-providers.md` (ADR-248). Письма идут через почтовый модуль
(`spec/mail.md`, ADR-246).

Перед работой прочитайте `AGENTS.md`, ADR-178 (RLS), ADR-094 (outbox) и `spec/IAM-v1.md`
(роли, организации).

## 0. Зачем и что в объёме

remo продаётся как облачный сервис с бесплатным тарифом и тремя платными, а также
распространяется под AGPL для установки на свой сервер. Биллинг должен:

1. Знать, какой тариф у организации и что ей можно: **права** (entitlements).
2. Проверять эти права на сервере в каждой точке, где тариф что-то ограничивает.
3. Вести подписки: покупка, продление, смена тарифа, отмена, льготный период, приостановка.
4. Выставлять счета и вести журнал платежей и возвратов, независимый от платёжного сервиса.
5. Работать с любым подключённым платёжным сервисом через один интерфейс
   (`spec/payment-providers.md`).
6. Полностью выключаться для self-host: без биллинга все ограничения сняты.

**Вне объёма v1:** пополняемый пользователем баланс (кошелёк), оплата по количеству
использования, партнёрские программы, налоговые расчёты для зарубежных юрисдикций (этим займётся
Paddle как продавец), счета-фактуры и акты для юрлиц (оплата по счёту есть, документооборот —
вручную).

## 1. Правила, которые нельзя нарушить

1. **Одна функция прав.** Тариф проверяется только через `entitlementsFor(orgId)`. Нигде
   нет `if (plan === "pro")`.
2. **Проверка на сервере.** Интерфейс только показывает ограничения. Обход интерфейса не
   обходит тариф.
3. **Данные не удаляются из-за тарифа.** При понижении тарифа или неоплате лишнее становится
   «только для чтения», но не удаляется. Экспорт и JSON-бэкап доступны всегда.
4. **Деньги — целые числа в минимальных единицах** (копейки, центы) плюс код валюты ISO 4217.
   Никаких float.
5. **Журнал только дописывается.** Платежи, возвраты и события биллинга не правятся и не
   удаляются. Исправление — новая запись.
6. **Платёжный сервис — не источник правды о тарифе.** Правда в нашей базе. Сервис
   сообщает факты (платёж прошёл, возврат выполнен), биллинг решает, что из этого следует.
7. **Идемпотентность везде.** Повтор вебхука, повтор списания или двойной клик «Оплатить» не
   создают второго платежа и не дают двух периодов.
8. **Автоплатёж — только с явного согласия** и с возможностью отключить его в один клик.
   Согласие хранится с версией текста и временем.
9. **Данные карт к нам не попадают.**
   - Карту плательщик вводит только на странице или в виджете платёжного сервиса.
   - Сервис сам хранит карту и отдаёт нам **ссылку на сохранённый способ оплаты** (у ЮKassa
     это `payment_method_id`). Без ключей нашего магазина ссылка бесполезна.
   - Мы храним эту ссылку (запечатанной KEK) и данные для показа, которые возвращает сервис:
     тип, платёжная система, последние 4 цифры, срок.
   - Номер карты целиком, CVV и данные 3-D Secure не проходят через наши серверы, не
     логируются и не сохраняются.
   - Обычно это самый лёгкий уровень требований PCI DSS для магазина (самооценка SAQ A).
     Точный уровень подтверждает платёжный сервис при подключении.

## 2. Тарифы и права

### 2.1 Тарифы и прайс-листы

Каталог делится на две части, потому что меняются они по разным причинам.

**1. Что даёт тариф** — места, лимиты, функции. Это поведение продукта, поэтому оно лежит в
коде (`apps/sync/billing-catalog.mjs`) и меняется через PR:

```js
export const PLANS = {
  free:     { seats: 5,  rooms: 5,    agentTasksPerMonth: 10,   trashDays: 7,  features: [] },
  pro:      { seats: 5,  rooms: null, agentTasksPerMonth: null, trashDays: 90, features: ALL_PAID, trialDays: 0 },
  team:     { seats: 20, rooms: null, agentTasksPerMonth: null, trashDays: 90, features: ALL_PAID, trialDays: 14 },
  business: { seats: 50, rooms: null, agentTasksPerMonth: null, trashDays: 90, features: ALL_PAID, trialDays: 14 },
};
```

**2. Сколько стоит** — это коммерческое решение, поэтому цены лежат в базе, в таблице
`prices` (§5). Ими управляет оператор (`pnpm billing:prices`, позже консоль), без релиза.
`billing-catalog.mjs` содержит только начальные цены для пустой базы
(`pnpm billing:prices seed`).

- **Цена — строка `(тариф, период, валюта, версия)`,** например `pro / month / RUB / v1 =
  29000` (290,00 ₽).
  - Цены в разных валютах — независимые прайс-листы, а не пересчёт по курсу: цена в рублях
    назначается под российский рынок, а не равна долларовой цене по курсу.
  - Курс в биллинге не используется вообще.
- **Цены включают налоги.** Плательщик видит итоговую сумму.
- **Цена не меняется: меняется версия.** Подписка хранит `price_id` и снимок суммы, поэтому
  новая цена не задевает действующие подписки. «Цена первых клиентов» и защита от повышения
  обеспечиваются этим, а не исключениями в коде.
- **Self-host.** При `REMO_BILLING=off` (по умолчанию) `entitlementsFor` возвращает план
  `unlimited`: без ограничений и без интерфейса оплаты.

### 2.1.1 Валюта

- **Установка задаёт, в каких валютах продаёт:** `REMO_BILLING_CURRENCIES=RUB` для
  российской, `USD,EUR` для европейской. Первая в списке — валюта по умолчанию.
- **У организации одна валюта** (`billing_accounts.currency`). Её выбирает плательщик при
  первой покупке из валют, доступных в установке. По умолчанию — валюта, подходящая стране
  плательщика, иначе первая в списке.
- **Пока у организации есть живая подписка, валюта не меняется.** Счета, возвраты и кредит
  ведутся в одной валюте, иначе журнал перестанет сходиться. Сменить валюту можно после
  окончания подписки или через оператора (он закрывает подписку и переносит остаток кредита
  по курсу, который сам указывает в команде).
- **Валюта ограничивает выбор платёжного сервиса.** Показываются только способы оплаты, для
  которых есть активное подключение с этой валютой (`spec/payment-providers.md` §3.3).
  Валюта, для которой нет ни одного подключения, не предлагается вовсе: `GET /billing/catalog`
  возвращает только валюты с хотя бы одним маршрутом.
- **Валюта продаётся, только если у неё полный прайс-лист.** Для каждого платного тарифа и
  каждого периода должна быть цена в статусе `for_sale`. Это проверяется командой
  `pnpm billing:prices check` и при старте; неполная валюта не показывается.

### 2.1.2 Как менять цены

1. **Новая цена для новых клиентов:**
   - `pnpm billing:prices add --plan pro --interval month --currency RUB --amount 34900` —
     создаётся версия `v2` в статусе `draft`;
   - `pnpm billing:prices publish <id>` — `v2` становится `for_sale`, прежняя `v1` —
     `sale_ended`;
   - новые покупки идут по `v2`, действующие подписки остаются на `v1`.
2. **Перевод действующих подписок на новую цену (по желанию):**
   - `pnpm billing:prices migrate --from <v1> --to <v2> --notice-days 30` планирует переход;
   - каждая затронутая организация получает письмо `price_change` с новой суммой и датой;
   - переход применяется при первом продлении после даты уведомления. Для годовых
     подписок — при следующем годовом продлении;
   - подписки с промокодом `price_override` (цена первых клиентов) миграция пропускает, если
     не указан `--include-overrides`.
3. **Снятие с продажи:** `sale_ended` → `archived`. Архивировать можно только версию без
   живых подписок.

Статусы цены: `draft` → `for_sale` → `sale_ended` → `archived`. Сумма опубликованной цены
никогда не редактируется. Каждое действие записывается в глобальный журнал `price_events`
(§5) с автором и причиной.

### 2.2 Права (entitlements)

```ts
type Entitlements = {
  plan: "free" | "pro" | "team" | "business" | "unlimited";
  // plan "unlimited" (self-host): status "active", limits: all fields null (no limit)
  status: "active" | "trialing" | "past_due" | "suspended";
  limits: { seats: number | null; rooms: number | null; agentTasksPerMonth: number | null;
            trashDays: number | null; storageBytes: number | null };
  features: Set<Feature>;
  // why a limit applies right now: "plan" | "past_due_grace" | "suspended"
  reason: string;
};
```

`unlimited` не продаётся и в каталоге тарифов отсутствует.

Перечень `Feature` — закрытый список в `billing-catalog.mjs`:

| Feature | Что открывает | Где проверять (файл) |
|---|---|---|
| `export.pdf` | экспорт PDF и экспорт с комментариями | `sync-export.mjs` |
| `export.no_watermark` | PNG без водяного знака | `sync-export.mjs` (клиент рисует знак, сервер решает, нужен ли он) |
| `link.protect` | пароль и срок действия публичной ссылки | `iam-api-boards.mjs` |
| `roles.advanced` | роли «комментатор», «совладелец» и команды | `iam-api-boards.mjs`, `iam-api-org.mjs` |
| `integrations` | вебхук, токены интеграций, MCP, панели приложений | `webhook-api.mjs`, `integration-api.mjs`, `app-api.mjs` |
| `agents.unlimited` | агенты без месячного лимита задач | `agent-api*.mjs` |

Лимиты:
- `seats` — см. §2.3;
- `rooms` — активные комнаты организации (не в корзине);
- `agentTasksPerMonth` — Free: 10;
- `trashDays` — Free: 7, платные: 90;
- `storageBytes` — заготовка под изображения, будет использована в ADR об изображениях.

**Где берутся права.** `entitlementsFor(orgId)` читает подписку и каталог и кеширует ответ в
процессе на 60 с. Любое событие биллинга этой организации сбрасывает кеш. `/auth/me`
отдаёт права для каждой организации пользователя, чтобы клиент показывал ограничения.

`/auth/me` — глобальный маршрут без `app.org_id`, а `subscriptions` защищена RLS. Права по
организациям собираются последовательными `withTenant(orgId, …)` (не более 20 организаций на
пользователя) и кешируются на 60 с; фоновая задача продления идёт через `withoutTenant` +
`withTenant`, как агентские циклы. Второго способа читать подписки нет.

**Личная организация** всегда Free: ей нельзя купить тариф. Чтобы работать командой, создают
общую организацию. Так проще и для пользователя («тариф у команды»), и для учёта мест.

### 2.3 Что такое «место»

Место занимает:
- активный участник организации (`org_memberships.relation = 'member'`, `state = 'active'`);
- гость (`relation = 'guest'`), у которого хотя бы в одной комнате организации роль «редактор»
  или выше.

Зрители и комментаторы мест не занимают. Посетители по публичной ссылке тоже.

Подсчёт — одна функция `seatUsage(orgId)` в `pg/billing.mjs` с одним SQL-запросом. Тест
проверяет каждый случай из списка выше.

### 2.4 Проверки и ответ при превышении

При превышении лимита или отсутствии функции маршрут отвечает:

```http
402 Payment Required
{ "error": "PLAN_LIMIT", "limit": "rooms", "current": 5, "max": 5, "plan": "free",
  "message": "the free plan allows 5 active rooms" }
```

или

```json
{ "error": "PLAN_FEATURE", "feature": "export.pdf", "plan": "free" }
```

Клиент по этим ответам показывает предложение сменить тариф с кнопкой «Посмотреть тарифы».

**Точки проверки лимитов:**

| Лимит | Действие | Файл |
|---|---|---|
| `rooms` | создание комнаты, восстановление из корзины, копия комнаты | `iam-api-org.mjs`, `iam-api-boards.mjs` |
| `seats` | создание приглашения участника; принятие приглашения; выдача гостю роли редактора и выше | `iam-api-invitations.mjs` (создание и принятие, включая гостя-редактора), `pg/iam-users.mjs` (принятие внутри транзакции), `iam-api-boards.mjs` (`PUT /boards/:id/grants`). Проверка при принятии обязательна внутри той же транзакции, что и вставка членства, иначе два одновременных принятия дают перебор. |
| `agentTasksPerMonth` | создание задачи агента | `agent-api*.mjs` |
| `trashDays` | ежедневная очистка корзины | новый ежедневный job в общем цикле задач; автоочистки сегодня нет, обещание в `content/help` и гайде меняется вместе с ней |

Принятие приглашения при заполненных местах отвечает `402 PLAN_LIMIT`. Приглашённый видит:
«В организации закончились места. Попросите администратора освободить место или сменить
тариф».

### 2.5 Превышение после понижения тарифа или неоплаты

Если организация оказалась над лимитом (перешла на меньший тариф или подписка
приостановлена):

- **Комнаты.** Активными остаются N последних изменённых. Остальные получают
  `boards.frozen_at` и открываются только для чтения. Владелец организации в настройках
  тарифа может выбрать, какие N комнат активны. Заморозка снимается автоматически, когда
  лимит позволяет.
  - Доступ к замороженной комнате считает существующая функция `effective()` в `iam.mjs`:
    при `frozen` от роли остаются только возможности уровня «зритель» плюс `board.export` и
    `board.backup`. Это одно новое условие в одной функции, а не второй механизм доступа.
  - Заморозка не повторяет архив (`archived_at`): у архивной комнаты остаётся только
    `board.read`, а замороженная сохраняет `board.export` и `board.backup`, иначе приёмка
    §13.4 невыполнима. Это отдельное условие в `effective()`, а не новый механизм доступа.
- **Места.** Никого не удаляем. Новые приглашения и повышение ролей запрещены, пока
  организация над лимитом. Через 14 дней все комнаты организации становятся только для
  чтения, пока число мест не придёт в норму. Баннер в организации предупреждает об этом с
  первого дня. Через 14 дней организация получает `orgs.read_only_at`; это ещё один вход в ту
  же `effective()` (как `ORG_SUSPENDED`), а не второй слой проверок.
- **Функции.** Работают как на новом тарифе: вебхук перестаёт доставлять события (они
  копятся и не теряются 30 дней), токены интеграций отвечают `402`, защищённые ссылки остаются
  с паролем (защиту не снимаем, новую поставить нельзя): снятие защиты задним числом — это
  ухудшение безопасности, а не понижение тарифа.
- **Первое включение биллинга.** Когда установка переходит с `REMO_BILLING=off` на `on`, у
  Free-организаций ретроактивно отзываются роли выше базовых (`commenter`, `coowner`
  понижаются до ближайшей бесплатной) и защищённые ссылки: пароль и срок снимаются, ссылка
  становится недействительной. Оба действия пишут аудит и уведомляют владельца организации;
  молчаливого понижения нет.

## 3. Подписка

### 3.1 Состояния

```
           checkout ok             renewal ok
 (none) ───────────────▶ active ◀───────────────┐
    │ trial                │  renewal failed     │
    ▼                      ▼                     │
 trialing ──────────▶  past_due ── paid ─────────┘
    │ no card               │ grace over (7 days)
    ▼                       ▼
  (Free)               suspended ── paid ──▶ active
                            │ 30 days
                            ▼
                         canceled → (Free)
```

| Состояние | Права | Что происходит |
|---|---|---|
| `trialing` | тарифа | 14 дней без карты; за 3 дня письмо; без карты в конце — Free |
| `active` | тарифа | продление в конце периода |
| `past_due` | тарифа (льготный период) | повторы списания по графику §3.3, письма, баннер |
| `suspended` | Free + §2.5 | платёж не прошёл за 7 дней; оплата возвращает `active` |
| `canceled` | Free | отменена владельцем или 30 дней в `suspended` |

`cancel_at_period_end = true` — подписка активна до конца периода, потом `canceled` без
списания.

Пробный период — опция каталога (`trialDays`), по умолчанию 14 дней для Team и Business и 0
для Pro. Один пробный период на организацию.

### 3.2 Кто управляет

Покупать, менять тариф, отменять и менять способ оплаты может любой `org_admin` организации
(`admin_roles`); отдельной роли «владелец» в модели нет, `orgs.created_by` — только
историческая запись. Остальные участники видят тариф и лимиты, но не платёжные данные.
Каждое действие пишет аудит (`billing.*`).

### 3.3 Продление (если продлевает биллинг)

Для сервисов, где мы сами списываем по сохранённому способу оплаты (ЮKassa, CloudPayments,
Robokassa), продлением управляет биллинг. Для сервисов, которые сами ведут подписку
(Paddle), биллинг зеркалит их события (`spec/payment-providers.md` §3).

Задача `billing-renewals` запускается каждые 10 минут:

1. Берёт подписки `active` с `current_period_end <= now()` и без `cancel_at_period_end`
   (`for update skip locked`).
2. Создаёт счёт на следующий период (если его ещё нет — идемпотентно по
   `(subscription_id, period_start)`).
3. Применяет кредит организации (§4.4).
4. Списывает остаток по сохранённому способу оплаты. Ключ идемпотентности =
   `invoice:{id}:attempt:{n}`.
5. Успех: период сдвигается, письмо `payment_succeeded`.
6. Неудача: `past_due`, письмо `payment_failed`. Повторы по графику: через 1, 3 и 6 дней.
   После 7 дней — `suspended`, письмо `subscription_suspended`.

Если ответ сервиса «в обработке», платёж ждёт вебхука или сверки (§5.3), повтор не
делается.

За 7 дней до продления **годовой** подписки — письмо `renewal_upcoming` с суммой и датой.

### 3.4 Смена тарифа и периода

- **Повышение** (Pro → Team, месяц → год) — сразу. Неиспользованная часть текущего периода
  пересчитывается в кредит пропорционально дням. Новый период начинается сейчас, к оплате —
  полная цена минус кредит. Перед подтверждением клиент видит расчёт
  (`POST .../change` с `preview: true`).
- **Понижение** (Team → Pro, год → месяц) — с конца текущего периода. До этого момента
  видна плашка «С {даты} тариф Pro».
- **Отмена** — с конца периода (`cancel_at_period_end`). «Возобновить» до конца периода
  снимает флаг.
- При понижении проверяется §2.5: если организация не помещается в новый тариф, интерфейс
  заранее показывает, что станет только для чтения.

### 3.5 Промокоды и цена первых клиентов

**Три вида скидки и их связь с валютой:**

| Вид | Значение | Валюта | Пример |
|---|---|---|---|
| `percent` | процент от цены | любая; работает во всех валютах | `LAUNCH30` — 30% на первые 3 месяца |
| `amount` | фиксированная сумма | **обязательна**; применим только к ценам в этой валюте | `MINUS100RUB` — 100 ₽ с первого счёта |
| `price_override` | заменить цену на другую | задаётся ссылкой на конкретную цену (`target_price_id`), валюта берётся из неё | `FOUNDER` — Pro за год по цене founder-версии |

**Ограничения кода:**
- тарифы, периоды и валюты, к которым он применим (пусто — ко всем);
- срок действия, лимит использований;
- `duration`: `once`, `repeating` (N периодов), `forever`;
- только для новых подписок или и для смены тарифа.

**Проверка при оформлении:** код подходит, только если совпадают тариф, период и валюта
цены. Если код `amount` в рублях введён при оплате в долларах — ошибка
`PROMO_CURRENCY_MISMATCH` с понятным текстом. Для одной кампании в разных валютах создаётся
по коду на валюту (`LAUNCH-RUB`, `LAUNCH-USD`) либо один `percent`.

**Скидка фиксируется в подписке.** При оформлении в `subscriptions.discount` копируется снимок:
вид, значение, валюта, сколько периодов осталось. Если позже код изменят или отключат, уже
выданная скидка не меняется.

**Порядок расчёта счёта** — одна функция `priceInvoice()`, без исключений:

```
base     = subscription.amount            (price snapshot)
discount = percent: floor(base × p / 100)
         | amount:  min(value, base)
         | override: base − target.amount (target snapshot taken at checkout)
credit   = min(org credit balance, base − discount)
total    = base − discount − credit       (≥ 0)
```

Если `total = 0`, счёт закрывается как оплаченный без обращения к платёжному сервису.

**Правила:**
- На одной подписке не больше одной скидки. Кредит применяется после скидки.
- «Цена первых клиентов» — это `price_override` на `forever` для годовой цены Pro (или
  отдельная цена, открытая только по коду). Миграция цен её не трогает (§2.1.2).

## 4. Деньги и документы

### 4.1 Счёт (invoice)

Счёт — документ к оплате за период: позиции, сумма, валюта, статус. Номера сквозные внутри
установки: `RU-2026-000123` / `EU-2026-000123`.

Статусы: `draft` → `open` → `paid` | `void` | `uncollectible`.

### 4.2 Платёж (payment)

Попытка оплатить счёт через конкретное подключение. Статусы: `pending` → `succeeded` |
`failed` | `canceled`. После возврата: `refunded` | `partially_refunded`. Уникален по
`(connection_id, provider_payment_id)`.

### 4.3 Возврат (refund)

- Делает только оператор установки (`spec/payment-providers.md` §6): CLI или операторская
  консоль. Указывает сумму (полную или частичную) и причину.
- Политика по умолчанию (текст в оферте, код ей не препятствует):
  - полный возврат первого платежа в течение 14 дней по запросу;
  - в остальных случаях подписка отменяется с конца периода без частичного возврата.
- Полный возврат текущего периода сразу переводит подписку в `canceled`.
- Чек возврата формирует платёжный сервис (§4.5).

### 4.4 Кредит организации («баланс»)

`org_credit_ledger` — журнал движений кредита организации в валюте установки:
- `+` пересчёт при повышении тарифа, компенсация от оператора, частичный возврат в кредит;
- `−` применение к счёту.

Баланс — сумма журнала. Кредит применяется к ближайшему счёту автоматически. Пополнить кредит
самому пользователю в v1 нельзя (вне объёма).

### 4.5 Чеки 54-ФЗ

Для российской установки чеки формирует облачная касса платёжного сервиса (ЮKassa,
CloudKassir, Робочеки). Биллинг передаёт в запрос платежа и возврата данные чека:
- позиция «Подписка remo {тариф}, {период}»;
- `payment_subject = service`, `payment_mode = full_payment`;
- ставка НДС и система налогообложения из настроек подключения (для ИП на УСН обычно «без
  НДС», уточнить у бухгалтера);
- email покупателя.

Если сервис не сформировал чек, это видно в журнале (`receipt_status`) и в метрике.

### 4.6 Выгрузка для бухгалтерии

`pnpm billing:export --month 2026-12 [--format csv]`. Одна строка на успешный платёж и на
возврат: дата, номер счёта, организация, сумма, валюта, сумма в рублях (для RUB равна сумме),
подключение, id платежа у сервиса, статус чека. Этого достаточно для КУДиР на УСН.

## 5. Данные (schema 22, после почты)

Все таблицы с `org_id` защищены RLS по ADR-178. `billing_provider_events` и
`payment_connections` — глобальные (организация неизвестна в момент приёма вебхука;
подключение — уровень установки), их схема в `spec/payment-providers.md`.

```sql
-- Price books: global (installation-level), managed by the operator (§2.1).
create table if not exists prices (
  id text primary key,                   -- e.g. 'pro-rub-month-v2'
  plan text not null,
  interval text not null check (interval in ('month', 'year')),
  currency text not null,                -- ISO 4217
  amount bigint not null check (amount >= 0),   -- minor units, tax-inclusive
  version integer not null,
  status text not null default 'draft'
    check (status in ('draft', 'for_sale', 'sale_ended', 'archived')),
  promo_only boolean not null default false,    -- sold only through a price_override code
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (plan, interval, currency, version)
);
-- At most one price for sale per plan, interval and currency (promo-only prices aside).
create unique index if not exists prices_for_sale_idx on prices (plan, interval, currency)
  where status = 'for_sale' and not promo_only;

create table if not exists price_events (
  id uuid primary key default gen_random_uuid(),
  price_id text references prices (id),
  type text not null,                    -- created | published | sale_ended | archived | migration_planned
  data jsonb not null default '{}'::jsonb,
  reason text,
  actor_id uuid references users (id),
  occurred_at timestamptz not null default now()
);

create table if not exists billing_accounts (
  org_id uuid primary key references orgs (id) on delete restrict,
  billing_email text not null,
  billing_name text,
  country text,                          -- ISO 3166-1 alpha-2, for routing and receipts
  currency text,                         -- set at first checkout; fixed while a subscription lives (§2.1.1)
  test_mode boolean not null default false,  -- routes only to test connections
  created_at timestamptz not null default now()
);

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  connection_id uuid not null,           -- payment_connections.id
  -- The provider's reference to a method IT stores (YooKassa payment_method_id and the
  -- like). Not card data: card numbers never reach remo (§1 rule 9). Sealed anyway,
  -- because together with our shop keys it can charge.
  ref_ciphertext bytea not null, ref_nonce bytea not null,
  ref_dek_wrapped bytea not null, ref_dek_nonce bytea not null, ref_kek_id text not null,
  display jsonb not null,                -- { kind, brand, last4, expMonth, expYear } as the provider returns it — nothing more
  state text not null default 'active' check (state in ('active', 'revoked', 'expired')),
  autopay_consent_at timestamptz not null,
  autopay_consent_version text not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  plan text not null,
  price_id text not null,
  amount bigint not null,                -- snapshot, minor units
  currency text not null,
  interval text not null check (interval in ('month', 'year')),
  status text not null check (status in ('trialing','active','past_due','suspended','canceled')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  pending_change jsonb,                  -- { plan, priceId, at } for a downgrade at period end
  trial_end timestamptz,
  past_due_since timestamptz,
  suspended_at timestamptz,
  canceled_at timestamptz,
  payment_method_id uuid references payment_methods (id),
  connection_id uuid,                    -- who renews it
  provider_subscription_id text,         -- only for provider-managed subscriptions (Paddle)
  promo_code_id uuid,
  -- snapshot of the discount at checkout: { kind, value, currency, targetAmount, periodsLeft }
  discount jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live subscription per organisation.
create unique index if not exists subscriptions_live_idx on subscriptions (org_id)
  where status in ('trialing','active','past_due','suspended');

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  subscription_id uuid references subscriptions (id),
  number text not null unique,
  status text not null check (status in ('draft','open','paid','void','uncollectible')),
  currency text not null,
  subtotal bigint not null, discount bigint not null default 0,
  credit_applied bigint not null default 0, total bigint not null,
  lines jsonb not null,
  period_start timestamptz, period_end timestamptz,
  due_at timestamptz, paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, period_start)
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  invoice_id uuid not null references invoices (id),
  connection_id uuid not null,
  provider_payment_id text,
  idempotency_key text not null unique,
  amount bigint not null, currency text not null,
  status text not null check (status in ('pending','succeeded','failed','canceled','refunded','partially_refunded')),
  failure_code text,                     -- normalized, see payment-providers §4
  receipt_status text,                   -- 'none' | 'pending' | 'issued' | 'failed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, provider_payment_id)
);

create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  payment_id uuid not null references payments (id),
  amount bigint not null, currency text not null,
  reason text not null,
  status text not null check (status in ('pending','succeeded','failed')),
  provider_refund_id text,
  idempotency_key text not null unique,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table if not exists org_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  amount bigint not null,                -- signed
  currency text not null,
  kind text not null check (kind in ('proration','goodwill','refund_to_credit','applied')),
  invoice_id uuid references invoices (id),
  note text,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table if not exists promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,             -- stored upper-case
  kind text not null check (kind in ('percent','amount','price_override')),
  value bigint,                          -- percent (1..100) or amount in minor units
  currency text,                         -- required for 'amount'
  target_price_id text references prices (id),  -- required for 'price_override'
  plans text[], intervals text[], currencies text[],  -- null = any
  new_subscriptions_only boolean not null default true,
  check (kind <> 'amount' or currency is not null),
  check (kind <> 'price_override' or target_price_id is not null),
  check (kind <> 'percent' or value between 1 and 100),
  duration text not null check (duration in ('once','repeating','forever')),
  duration_periods integer,
  max_redemptions integer, redeemed integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  type text not null,                    -- e.g. subscription.activated, payment.failed
  subject_id uuid,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

alter table boards add column if not exists frozen_at timestamptz;
alter table orgs add column if not exists read_only_at timestamptz;
```

`orgs.read_only_at` — дополнительно к §2.5.

`on delete restrict` у денег: организацию с платёжной историей нельзя удалить каскадом.
Удаления организации в v1 нет вообще — есть только архив; поэтому `restrict` фиксирует правило
на будущее, а тесты, которые сейчас удаляют организации прямым SQL, обязаны сначала удалять
денежные строки. ADR-247 говорит именно об этом.

## 6. API

Все маршруты в `billing-api.mjs`. Мутации проходят CSRF/Origin, права — §3.2.

| Метод и путь | Что делает |
|---|---|
| `GET /billing/catalog?currency=` | без сессии (нужно и лендингу): валюты с хотя бы одним платёжным маршрутом, для каждой — цены `for_sale` и доступные способы оплаты; лимиты тарифов из кода |
| `GET /orgs/:id/billing` | тариф, права, использование (места, комнаты, задачи агентов), подписка, способ оплаты (`display`), кредит |
| `POST /orgs/:id/billing/checkout` | `{ priceId, methodGroup, promoCode?, consent: { autopay: true, termsVersion } }` → `{ redirectUrl \| widget }`. Валюта берётся из цены; при первой покупке она записывается в `billing_accounts.currency`, позже обязана с ней совпадать (`409 CURRENCY_LOCKED`). Создаёт счёт и платёж `pending` |
| `POST /billing/promo/check` | `{ code, priceId }` → скидка и итог, или `PROMO_INVALID`, `PROMO_EXPIRED`, `PROMO_CURRENCY_MISMATCH`, `PROMO_NOT_APPLICABLE` |
| `GET /orgs/:id/billing/checkout/:paymentId` | статус после возврата со страницы оплаты (клиент опрашивает до `succeeded`/`failed`, 60 с) |
| `POST /orgs/:id/billing/change` | `{ priceId, preview }` → расчёт или применение (§3.4) |
| `POST /orgs/:id/billing/cancel` | отмена с конца периода |
| `POST /orgs/:id/billing/resume` | снять отмену |
| `POST /orgs/:id/billing/payment-method` | заменить способ оплаты: проверка карты без списания или на минимальную сумму с отменой, в зависимости от возможностей подключения |
| `DELETE /orgs/:id/billing/payment-method` | отвязать способ оплаты и выключить автоплатёж; подписка доживает до конца периода |
| `GET /orgs/:id/billing/invoices` | счета, платежи, ссылки на чеки |
| `PUT /orgs/:id/billing/frozen-rooms` | выбор, какие комнаты активны при превышении (§2.5) |
| `POST /billing/webhooks/:connectionId/:token` | приём событий платёжного сервиса (`spec/payment-providers.md` §5) |

Коды `402` несут `limit`, `current`, `max`, `plan` (или `feature`); общий `fail()` в
`iam-http.mjs` их не умеет, поэтому ответ собирается отдельным помощником в `billing-api.mjs`.

`methodGroup` — что выбрал плательщик: `ru_card` (карта российского банка, СБП), `foreign_card`,
`invoice` (оплата по счёту для юрлиц). Какое подключение обслужит группу, решает
маршрутизация (`spec/payment-providers.md` §3.3).

## 7. Письма

Добавляются в шаблоны почтового модуля (расширить `check` в `mail_outbox.template` и
`mail-templates.mjs`, RU и EN):

| Шаблон | Когда |
|---|---|
| `payment_succeeded` | оплата прошла: сумма, период, ссылка на чек |
| `payment_failed` | списание не прошло: когда повтор, кнопка «Обновить способ оплаты» |
| `trial_ending` | за 3 дня до конца пробного периода |
| `renewal_upcoming` | за 7 дней до продления годовой подписки |
| `subscription_suspended` | права понижены до Free, данные на месте |
| `subscription_canceled` | подписка закончилась |
| `payment_method_expiring` | срок карты истекает до следующего продления |
| `price_change` | за `--notice-days` до перевода подписки на новую цену (§2.1.2): старая и новая сумма, дата |
| `payment_method_migrate` | подключение выводится из работы: нужно ввести карту заново (`spec/payment-providers.md` §2) |

Письма идут на `billing_accounts.billing_email` и копией владельцу организации, если адрес
другой.

## 8. Интерфейс (`apps/web`)

1. **Настройки организации → «Тариф и оплата»:**
   - Раздел «Тариф и оплата» — четвёртая вкладка `OrganisationDialog`
     (`people | audit | agents | billing`), отдельного экрана не появляется.
   - текущий тариф, статус, дата продления, сумма;
   - использование: места X/Y, комнаты X/Y, задачи агентов X/Y;
   - способ оплаты (`•••• 4242`, срок), кнопки «Заменить» и «Отвязать»;
   - счета с чеками;
   - «Сменить тариф», «Отменить подписку» / «Возобновить»;
   - кредит, если не ноль.
2. **Выбор тарифа:** таблица тарифов из `/billing/catalog`, переключатель «месяц / год»,
   поле промокода.
3. **Оплата:**
   - выбор способа («Карта российского банка или СБП», «Иностранная карта», «Счёт для
     юрлица»);
   - флажок согласия на автоплатёж с текстом и ссылкой на оферту — без отметки кнопка
     неактивна;
   - переход на страницу сервиса, возврат на `?billing=return&payment=<id>`, ожидание
     результата.
4. **Ограничения:** на ответ `402` — понятная плашка, что ограничено и почему, и кнопка
   «Посмотреть тарифы». Для участника без права оплаты — «Попросите владельца организации».
5. **Баннеры:** `past_due` («Не удалось списать оплату, обновите карту до {даты}»),
   превышение мест (§2.5), замороженные комнаты (значок на плитке и плашка в комнате).
6. **Личная организация:** вместо кнопки покупки — «Создайте общую организацию для команды».

Все строки — через `i18n`, все цвета и размеры — из `@remo/ui`.

Новые вызовы API и типы — в новых файлах (`apiBilling.ts`), не в `api.ts`: он ровно 800
строк и `pnpm size:check` не даст добавить ни строки.

## 9. Безопасность и надёжность (чек-лист)

- [ ] Права проверяются на сервере во всех точках §2.4. Есть тест на каждую точку.
- [ ] Платёж считается успешным только после проверенного события сервиса или запроса
      статуса к его API. Возврат пользователя на `return_url` ничего не доказывает.
- [ ] Повтор вебхука, повтор задачи продления и двойной запрос checkout не создают второй
      платёж и второй период (тесты).
- [ ] Суммы — целые; округление при пересчёте — в пользу клиента (вниз), правило в одном
      месте.
- [ ] Токен способа оплаты запечатан KEK, наружу отдаётся только `display`.
- [ ] Номер карты целиком никогда не попадает к нам (оплата на стороне сервиса).
- [ ] Отвязка способа оплаты работает в один клик и выключает автоплатёж.
- [ ] Согласие на автоплатёж хранится с версией текста.
- [ ] Журналы `payments`, `refunds`, `billing_events`, `org_credit_ledger` только
      дописываются (нет `update` сумм, нет `delete`; тест на уровне `pg/billing.mjs`).
- [ ] При `REMO_BILLING=off` ни одна проверка прав ничего не ограничивает, маршруты
      `/billing/*` отвечают `404`.

## 10. Метрики

- `remo_billing_mrr_minor{currency}` — gauge, считается при рендере `/metrics`;
- `remo_billing_subscriptions{plan,status}` — gauge;
- `remo_billing_payments_total{connection,status}`;
- `remo_billing_renewal_failures_total{code}`;
- `remo_billing_receipt_failures_total`;
- `remo_billing_plan_limit_total{limit}` — сколько раз пользователи упёрлись в лимит; это
  главный сигнал для продуктовых решений.

## 11. Тесты

- **Юнит:**
  - `entitlementsFor` для каждого плана и статуса;
  - `seatUsage` — каждый случай §2.3;
  - пересчёт при смене тарифа (таблица случаев, включая високосный год и смену в последний
    день);
  - `priceInvoice` — таблица случаев: каждый вид скидки × `once`/`repeating`/`forever` ×
    кредит; итог никогда не меньше нуля;
  - промокоды: несовпадение валюты, тарифа, периода; истёкший и исчерпанный код; изменение
    кода не меняет выданную скидку;
  - прайс-листы: публикация новой версии снимает старую с продажи; сумма опубликованной
    цены не редактируется; неполный прайс-лист валюты скрывает валюту; миграция с
    уведомлением применяется только после даты и пропускает `price_override`;
  - валюта организации фиксируется первой покупкой (`CURRENCY_LOCKED`);
  - номер счёта;
  - деньги без float.
- **Машина состояний подписки** с подменяемыми часами: пробный период → оплата →
  продление → неудача → повторы → `suspended` → оплата → `active`; отмена; понижение в конце
  периода.
- **С базой:**
  - RLS для всех таблиц с `org_id` (вторая организация видит 0 строк);
  - RLS: `billing_accounts`, `payment_methods`, `subscriptions`, `invoices`, `payments`,
    `refunds`, `org_credit_ledger`, `billing_events` внесены в `apps/sync/rls.sql` и
    `rls-admin.mjs`; проверка «вторая организация видит 0 строк» на каждую;
  - уникальность живой подписки;
  - идемпотентность продления при двух параллельных запусках;
  - Планировщик: продление, очистка корзины и сверка идут через один общий цикл (новый
    модуль), а не через три `setInterval`.
- **Точки ограничений:** для каждой строки §2.4 — `402` на Free и успех на Pro.
- **Заморозка:** при понижении активны последние N комнат; замороженная открывается на
  чтение; экспорт и бэкап работают; повышение размораживает.
- **Сквозной сценарий** с тестовым адаптером `pay-fake` (`spec/payment-providers.md` §8):
  покупка Pro → письмо → смена на Team с пересчётом → неудачное продление → льготный период
  → приостановка → оплата → возврат оператором.
- **Self-host:** `REMO_BILLING=off` — весь набор e2e версии 0.4.1 проходит без изменений.

## 12. Этапы (каждый — отдельный PR, каждый проходит `pnpm verify`)

1. **Права без денег.**
   - Каталог, `entitlementsFor`, `seatUsage`, все точки §2.4, заморозка §2.5.
   - Подписки назначает только оператор через CLI (`pnpm billing:grant --org <id> --plan team
     --until 2027-03-01`).
   - Таблица `prices` и `pnpm billing:prices` (`seed`, `add`, `publish`, `check`, `list`):
     цены нужны уже здесь, чтобы показывать их в интерфейсе и на лендинге.
   - С этим этапом можно запускать закрытую бету и выдавать тарифы вручную.
2. **Журнал и оплата по счёту.**
   - Счета, платежи, возвраты, кредит, промокоды, `billing_events`, выгрузка.
   - Подключение `manual`: оператор отмечает счёт оплаченным.
   - Подходит юрлицам, платящим по счёту.
3. **Первый платёжный сервис и продление.**
   - ЮKassa по `spec/payment-providers.md`, checkout, сохранение способа оплаты, задача
     продления, льготный период, письма §7, чеки.
4. **Интерфейс.** §8 целиком и e2e.
5. **Иностранные карты.** Robokassa (или Prodamus) по `spec/payment-providers.md`.
6. **Позже, отдельным решением.** Paddle для европейской установки — после регистрации
   зарубежного юрлица.

## 13. Приёмка

1. `pnpm verify --e2e` зелёный при `REMO_BILLING=off` и при `REMO_BILLING=on`.
2. В тестовом режиме ЮKassa:
   - реальная тестовая карта проходит покупку, продление (с ручным сдвигом часов в
     тестовой базе), неудачу продления (тестовая карта с отказом), возврат;
   - каждое событие видно в журнале;
   - тестовый чек сформирован.
3. Повторная отправка всех вебхуков за день (скрипт) не меняет ни одной суммы и ни одного
   периода.
4. Организация на Free с 7 комнатами после понижения: 5 активных, 2 только для чтения;
   экспорт и бэкап работают; повышение тарифа снимает заморозку.
5. Отвязка карты выключает продление: в конце периода подписка `canceled`, списаний нет.
6. Выгрузка за месяц сходится с отчётом ЮKassa по сумме и числу операций.
7. Чек-лист §9 отмечен в описании PR со ссылками на тесты.

## 14. Решения, которые остаются за владельцем продукта

- Начальные прайс-листы: RUB для российской установки, USD и/или EUR для европейской. Их
  можно менять позже без релиза (§2.1.2).
- Решено 20.11: пробный период 14 дней для Team и Business, у Pro его нет; лимиты Free:
  5 комнат, 10 задач агента в месяц, корзина 7 дней.
- Политика возвратов в оферте.
- Подход к ИП: НДС и система налогообложения для чеков — с бухгалтером.
