/**
 * RU strings — тарифы, оплата и ограничения тарифа (ADR-247, `spec/billing.md` §8).
 *
 * Исходный язык этих экранов; EN повторяет ключи один к одному.
 */
export const ruBilling = {
  "billing.tab": "Тариф и оплата",

  "billing.plan": "Тариф",
  "billing.status": "Статус",
  "billing.amount": "Сумма",
  "billing.renews": "Продление",
  "billing.ends": "Окончание",
  "billing.credit": "Кредит",
  "billing.usage": "Использование",
  "billing.usage.seats": "Места {used}/{max}",
  "billing.usage.seatsUnlimited": "Места {used}, без ограничения",
  "billing.usage.rooms": "Комнаты {used}/{max}",
  "billing.usage.roomsUnlimited": "Комнаты {used}, без ограничения",
  "billing.paymentMethod": "Способ оплаты",
  "billing.cardMasked": "•••• {last4}",
  "billing.cardExpires": "до {month}/{year}",
  "billing.noPaymentMethod": "Сохранённого способа оплаты нет.",
  "billing.card.replace": "Заменить",
  "billing.card.attach": "Привязать карту",
  "billing.card.unavailable": "Оплата картой пока недоступна на этой установке.",
  "billing.card.choosePlan": "Карта сохраняется при оплате тарифа. Сначала выберите тариф.",
  "billing.card.instructions":
    "Продолжите в окне провайдера. Новая карта появится здесь после подтверждения провайдером.",

  "billing.rooms.title": "Активные комнаты",
  "billing.rooms.hint":
    "Тариф сохраняет {max} активных комнат. Остальные станут только для чтения: содержимое сохранится, экспорт продолжит работать.",
  "billing.rooms.choose": "Выбрать активные",
  "billing.rooms.change": "Изменить активные",
  "billing.rooms.counter": "Выбрано {selected} из {max}",
  "billing.rooms.fewer":
    "Выбрано {selected} из {max}. Остальные комнаты станут только для чтения.",
  "billing.rooms.save": "Сохранить",
  "billing.rooms.saving": "Сохраняем…",
  "billing.rooms.saved": "Сохранено",
  "billing.rooms.loadFailed": "Не удалось загрузить комнаты. Попробуйте ещё раз.",
  "billing.rooms.empty": "В организации пока нет комнат.",
  "billing.rooms.badList":
    "Сервер не принял этот список. Обновите страницу и попробуйте ещё раз.",
  "billing.rooms.gone":
    "Одна из комнат больше не принадлежит этой организации. Обновите список.",
  "billing.rooms.forbidden": "Выбрать активные комнаты может только владелец организации.",
  "billing.rooms.askOwner":
    "Организация превысила лимит комнат. Попросите владельца выбрать, какие комнаты останутся активными.",

  "billing.changePlan": "Сменить тариф",
  "billing.cancel": "Отменить подписку",
  "billing.cancelConfirm":
    "Тариф работает до конца оплаченного периода и не продлевается. Продолжить?",
  "billing.resume": "Возобновить подписку",
  "billing.askOwner": "Попросите владельца организации сменить тариф.",
  "billing.personal":
    "Тариф покупает общая организация. Создайте общую организацию для команды.",

  "billing.readOnly":
    "Организация превысила лимиты тарифа: комнаты только для чтения, данные не удаляются.",
  "billing.pastDue":
    "Оплата не прошла. Обновите способ оплаты до конца льготного периода.",
  "billing.suspended":
    "Подписка приостановлена. До оплаты организация работает на бесплатном тарифе.",

  "billing.choose.title": "Выбор тарифа",
  "billing.choose.hint":
    "Сумма зависит от периода. Промокод проверяется до оплаты.",
  "billing.back": "Назад",
  "billing.period": "Период оплаты",
  "billing.period.month": "Месяц",
  "billing.period.year": "Год",
  "billing.currency": "Валюта",

  "billing.promo": "Промокод",
  "billing.promo.placeholder": "LAUNCH30",
  "billing.promo.check": "Проверить",
  "billing.promo.applied": "Скидка {discount}, к оплате {total}",
  "billing.promo.invalid": "Этот код нельзя применить.",
  "billing.promo.expired": "Срок действия кода истёк.",
  "billing.promo.currency": "Код действует в другой валюте.",
  "billing.promo.notApplicable": "Код не подходит к выбранному тарифу.",

  "billing.method": "Способ оплаты",
  "billing.method.ru_card": "Карта российского банка или СБП",
  "billing.method.foreign_card": "Иностранная карта",
  "billing.method.invoice": "Счёт для юрлица",

  "billing.terms": "Принимаю условия оферты",
  "billing.termsLink": "Оферта",
  "billing.pay": "Оплатить {amount}",
  "billing.paying": "Запускаем оплату…",
  "billing.checkout.created": "Счёт {id}",
  "billing.checkout.waiting":
    "Счёт выставлен. Тариф включится после подтверждения оплаты.",
  "billing.checkout.failed": "Не удалось начать оплату.",
  "billing.checkout.forbidden": "Оплатить может только администратор организации.",
  "billing.checkout.currencyLocked": "Организация платит в другой валюте.",
  "billing.checkout.consent": "Подтвердите согласие с офертой.",
  "billing.checkout.noRoute": "Этот способ оплаты сейчас недоступен.",
  "billing.checkout.unavailable": "Этот тариф не продаётся.",

  "billing.invoices": "Счета",
  "billing.invoiceNumber": "Номер",
  "billing.invoiceDate": "Дата",
  "billing.invoiceTotal": "Сумма",
  "billing.invoiceStatus": "Статус",
  "billing.invoiceReceipt": "Чек",
  "billing.invoicesEmpty": "Счетов пока нет.",
  "billing.invoice.draft": "Черновик",
  "billing.invoice.open": "Ожидает оплаты",
  "billing.invoice.paid": "Оплачен",
  "billing.invoice.void": "Аннулирован",
  "billing.invoice.uncollectible": "Безнадёжный",

  "billing.plan.free": "Бесплатный",
  "billing.plan.pro": "Pro",
  "billing.plan.team": "Team",
  "billing.plan.business": "Business",
  "billing.plan.unlimited": "Без ограничений",
  "billing.subscription.trialing": "Пробный период",
  "billing.subscription.active": "Активна",
  "billing.subscription.past_due": "Ожидает оплаты",
  "billing.subscription.suspended": "Приостановлена",
  "billing.subscription.canceled": "Отменена",

  "billing.loading": "Загрузка…",
  "billing.failed": "Что-то пошло не так. Попробуйте ещё раз.",
  "billing.noCatalog": "Не удалось загрузить каталог тарифов.",
  "billing.actionUnavailable":
    "Управление подпиской пока недоступно на этом сервере.",
  "billing.close": "Закрыть",

  "billing.planLimit": "Ограничение тарифа: {what}",
  "billing.seePlans": "Посмотреть тарифы",
  "billing.dismiss": "Скрыть",
  "billing.limit.rooms": "активные комнаты {current}/{max}",
  "billing.limit.roomsShort": "активные комнаты",
  "billing.limit.seats": "места {current}/{max}",
  "billing.limit.seatsShort": "места",
  "billing.limit.agents": "задачи агентов за месяц {current}/{max}",
  "billing.limit.agentsShort": "задачи агентов",
  "billing.limit.other": "это действие",
  "billing.feature.export.pdf": "экспорт PDF",
  "billing.feature.export.no_watermark": "PNG без водяного знака",
  "billing.feature.link.protect": "защищённые публичные ссылки",
  "billing.feature.roles.advanced": "расширенные роли",
  "billing.feature.integrations": "интеграции",
  "billing.feature.agents.unlimited": "агенты без месячного лимита",
  "billing.feature.other": "эта функция",
  "billing.frozenRoom":
    "Комната только для чтения по тарифу. Содержимое сохранено, экспорт работает.",

  "fake.title": "Тестовый платёжный провайдер",
  "fake.hint": "Этот экран существует только в тестовой установке. Деньги не списываются.",
  "fake.unavailable": "Тестовый платёжный провайдер недоступен на этой установке.",
  "fake.error": "Тестовый провайдер не ответил. Попробуйте ещё раз.",
  "fake.amount": "Сумма",
  "fake.statusLabel": "Статус",
  "fake.status.pending": "Ожидает",
  "fake.status.succeeded": "Успешно",
  "fake.status.failed": "Отказ",
  "fake.status.canceled": "Отменён",
  "fake.success": "Успешно",
  "fake.fail": "Отказ",
  "fake.finished": "Результат записан. Вернитесь в биллинг.",
};
