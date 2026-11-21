/**
 * RU strings — the support entry, the isolated widget and the opt-in context
 * (ADR-250, `spec/support.md` §2).
 *
 * The source language. The waiting text comes from `REMO_SUPPORT_HOURS` on the server.
 */
export const ruSupport = {
  "support.menu": "Помощь и поддержка",
  "support.title": "Помощь и поддержка",
  "support.close": "Закрыть поддержку",
  "support.frameTitle": "Чат поддержки",
  "support.loading": "Открываем чат поддержки…",
  "support.error": "Поддержка сейчас недоступна. Попробуйте через минуту.",
  /** The crash screen: a report with the error already in hand. */
  "support.reportBug": "Сообщить об ошибке",
  /** The help centre header. Shown only to a signed-in person. */
  "support.write": "Написать в поддержку",
  /** Beside a plan limit: the person's question is about money, not about the screen. */
  "support.planQuestion": "Есть вопросы о тарифе?",
  "support.technical": "Приложить техническую информацию",
  "support.technicalHint":
    "Версия, браузер, последние ошибки и номер этой комнаты с вашей ролью. Название и содержимое комнаты не передаются.",
  "support.technicalGranted": "Передаётся только в чат поддержки. На серверы remo эти данные не уходят.",
};
