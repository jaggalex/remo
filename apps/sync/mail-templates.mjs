/**
 * Transactional mail templates in RU and EN (ADR-246, `spec/mail.md` §6).
 *
 * The copy below is normative: changing a word means changing the spec. The renderer only
 * substitutes values, escapes them for HTML and keeps every line participants can click on
 * available as plain text too, because a text/plain letter is not a stub for the HTML one.
 *
 * There are no tracking pixels and no rewritten links: the URL the caller passes is the URL
 * the recipient sees.
 */
export const MAIL_TEMPLATES = [
  "verify_email",
  "password_reset",
  "password_changed",
  "invitation",
  "payment_succeeded",
  "payment_failed",
  "trial_ending",
  "renewal_upcoming",
  "subscription_suspended",
  "subscription_canceled",
  "payment_method_expiring",
  "price_change",
  "payment_method_migrate",
];

const LOCALES = ["ru", "en"];

const TARGET_KINDS = {
  ru: { organisation: "организацию", room: "комнату" },
  en: { organisation: "organisation", room: "room" },
};

const BUTTON_LABELS = {
  ru: {
    verify_email: "Подтвердить почту",
    password_reset: "Задать новый пароль",
    password_changed: "Сбросить пароль",
    invitation: "Принять приглашение",
    payment_succeeded: "Посмотреть счёт",
    payment_failed: "Обновить способ оплаты",
    trial_ending: "Выбрать тариф",
    renewal_upcoming: "Проверить подписку",
    subscription_suspended: "Восстановить доступ",
    subscription_canceled: "Возобновить подписку",
    payment_method_expiring: "Обновить карту",
    price_change: "Посмотреть условия",
    payment_method_migrate: "Ввести карту заново",
  },
  en: {
    verify_email: "Confirm email",
    password_reset: "Set a new password",
    password_changed: "Reset password",
    invitation: "Accept invitation",
    payment_succeeded: "View invoice",
    payment_failed: "Update payment method",
    trial_ending: "Choose a plan",
    renewal_upcoming: "Review subscription",
    subscription_suspended: "Restore access",
    subscription_canceled: "Resume subscription",
    payment_method_expiring: "Update card",
    price_change: "Review terms",
    payment_method_migrate: "Enter card again",
  },
};

const FONT_FAMILY = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Template failures are programmer errors, not delivery failures: a missing link cannot be
 * retried, so they never become a `MailError` with `retryable`.
 */
function templateError(code, param) {
  const error = new Error(param ? `${code}: ${param}` : code);
  error.code = code;
  if (param) error.param = param;
  return error;
}

/**
 * A single-line field. Newlines are removed because a subject or a name must not be able to
 * split a line, and an empty value is treated as absent rather than rendered as a hole.
 */
function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function param(params, name, { required = true } = {}) {
  const raw = params[name];
  if (raw === undefined || raw === null) {
    if (required) throw templateError("MISSING_PARAM", name);
    return null;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    // An object would stringify to `[object Object]` and a boolean to `true`; neither is a
    // substitute value a reader should ever receive.
    if (required) throw templateError("MISSING_PARAM", name);
    return null;
  }
  const value = singleLine(raw);
  if (!value) {
    if (required) throw templateError("MISSING_PARAM", name);
    return null;
  }
  return value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function documentHtml({ lang, paragraphs, footer, link, label }) {
  const href = escapeHtml(link);
  const rows = paragraphs
    .map((paragraph) => `              <p style="margin:0 0 16px;">${paragraph}</p>`)
    .join("\n");
  const footerHtml = footer
    ? `\n              <p style="margin:0;font-size:14px;line-height:1.5;color:#57534e;">${footer}</p>`
    : "";
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f5f4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f4;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:24px;font-family:${FONT_FAMILY};font-size:16px;line-height:1.5;color:#1c1917;">
${rows}
                <p style="margin:0 0 24px;">
                  <a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1c1917;color:#ffffff;text-decoration:none;font-weight:600;">${label}</a>
                </p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.4;color:#57534e;word-break:break-all;">
                  <a href="${href}" style="color:#57534e;">${escapeHtml(link)}</a>
                </p>${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function notification(lang, { subject, body, action, notice, link, label }) {
  return {
    subject,
    text: `${body.join(" ")} ${action} ${link}\n\n${notice}`,
    html: documentHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(label),
    }),
  };
}

/**
 * Billing amounts arrive as a display string the caller already formatted ("290,00 ₽");
 * the template never guesses a currency or appends the ISO code, or the sum would read
 * "290,00 ₽ RUB". `currency` is still required so a caller cannot quietly drop it.
 */
function money(values, name = "amount") {
  const amount = param(values, name);
  param(values, "currency");
  return amount;
}

function verifyEmail(lang, values) {
  const link = param(values, "link");
  const name = param(values, "name", { required: false });
  const product = values.product;

  if (lang === "ru") {
    const greeting = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
    const confirm = "Подтвердите, что это ваш адрес";
    const notice = `Ссылка действует 24 часа. Если вы не регистрировались в ${product}, просто удалите это письмо.`;
    return {
      subject: `Подтвердите почту для ${product}`,
      text: `${greeting} ${confirm}: ${link}\n\n${notice}`,
      html: documentHtml({
        lang,
        paragraphs: [escapeHtml(greeting), escapeHtml(`${confirm}.`)],
        footer: escapeHtml(notice),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].verify_email),
      }),
    };
  }

  const greeting = name ? `Hi ${name},` : "Hi,";
  const confirm = "please confirm this is your address";
  const notice = `The link works for 24 hours. If you didn't sign up for ${product}, you can ignore this email.`;
  return {
    subject: `Confirm your email for ${product}`,
    text: `${greeting} ${confirm}: ${link}\n\n${notice}`,
    html: documentHtml({
      lang,
      paragraphs: [escapeHtml(greeting), escapeHtml(`${confirm}.`)],
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].verify_email),
    }),
  };
}

function passwordReset(lang, values) {
  const link = param(values, "link");
  const product = values.product;

  if (lang === "ru") {
    const who = "Кто-то (надеемся, вы) запросил сброс пароля.";
    const action = "Задать новый пароль:";
    const notice =
      "Ссылка действует 60 минут и сработает один раз. Если это были не вы, ничего не делайте: пароль останется прежним.";
    return {
      subject: `Сброс пароля в ${product}`,
      text: `${who} ${action} ${link}\n\n${notice}`,
      html: documentHtml({
        lang,
        paragraphs: [escapeHtml(who)],
        footer: escapeHtml(notice),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].password_reset),
      }),
    };
  }

  const who = "Someone (hopefully you) asked to reset your password.";
  const action = "Set a new one:";
  const notice =
    "The link works once, for 60 minutes. If it wasn't you, do nothing — your password stays the same.";
  return {
    subject: `Reset your ${product} password`,
    text: `${who} ${action} ${link}\n\n${notice}`,
    html: documentHtml({
      lang,
      paragraphs: [escapeHtml(who)],
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].password_reset),
    }),
  };
}

function passwordChanged(lang, values) {
  const email = param(values, "email");
  const forgotLink = param(values, "forgotLink");
  const product = values.product;

  if (lang === "ru") {
    const changed = `Пароль вашего аккаунта ${email} только что изменили, все сеансы завершены.`;
    const advice = "Если это были не вы, сразу сбросьте пароль:";
    return {
      subject: `Пароль в ${product} изменён`,
      text: `${changed} ${advice} ${forgotLink}`,
      html: documentHtml({
        lang,
        paragraphs: [escapeHtml(changed)],
        footer: escapeHtml("Если это были не вы, сразу сбросьте пароль."),
        link: forgotLink,
        label: escapeHtml(BUTTON_LABELS[lang].password_changed),
      }),
    };
  }

  const changed = `The password for ${email} was just changed and all sessions were signed out.`;
  const advice = "If this wasn't you, reset your password now:";
  return {
    subject: `Your ${product} password was changed`,
    text: `${changed} ${advice} ${forgotLink}`,
    html: documentHtml({
      lang,
      paragraphs: [escapeHtml(changed)],
      footer: escapeHtml("If this wasn't you, reset your password now."),
      link: forgotLink,
      label: escapeHtml(BUTTON_LABELS[lang].password_changed),
    }),
  };
}

function invitation(lang, values) {
  const inviter = param(values, "inviter");
  const target = param(values, "target");
  const targetKey = param(values, "targetKind");
  const expires = param(values, "expires");
  const link = param(values, "link");
  const product = values.product;

  const kind = Object.hasOwn(TARGET_KINDS[lang], targetKey)
    ? TARGET_KINDS[lang][targetKey]
    : null;
  if (!kind) throw templateError("UNKNOWN_TARGET_KIND");

  if (lang === "ru") {
    const line = `${inviter} приглашает вас в ${kind} «${target}» в ${product}.`;
    const notice = `Приглашение действует до ${expires}.`;
    return {
      subject: `${inviter} приглашает вас в ${target}`,
      text: `${line} Принять приглашение: ${link}\n\n${notice}`,
      html: documentHtml({
        lang,
        paragraphs: [
          `${escapeHtml(inviter)} приглашает вас в ${escapeHtml(kind)} «<strong>${escapeHtml(target)}</strong>» в ${escapeHtml(product)}.`,
        ],
        footer: escapeHtml(notice),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].invitation),
      }),
    };
  }

  const line = `${inviter} invited you to the ${kind} "${target}" on ${product}.`;
  const notice = `The invitation is valid until ${expires}.`;
  return {
    subject: `${inviter} invited you to ${target}`,
    text: `${line} Accept: ${link}\n\n${notice}`,
    html: documentHtml({
      lang,
      paragraphs: [
        `${escapeHtml(inviter)} invited you to the ${escapeHtml(kind)} "<strong>${escapeHtml(target)}</strong>" on ${escapeHtml(product)}.`,
      ],
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].invitation),
    }),
  };
}

function paymentSucceeded(lang, values) {
  const amount = money(values);
  const period = param(values, "period");
  const invoiceUrl = param(values, "invoiceUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Платёж в ${product} получен`,
      body: [`Платёж на ${amount} за ${period} прошёл.`],
      action: "Счёт:",
      notice: "Это письмо подтверждает оплату, отдельного действия не требуется.",
      link: invoiceUrl,
      label: BUTTON_LABELS[lang].payment_succeeded,
    });
  }

  return notification(lang, {
    subject: `Payment to ${product} received`,
    body: [`We received ${amount} for ${period}.`],
    action: "Invoice:",
    notice: "This email confirms the payment; no action is needed.",
    link: invoiceUrl,
    label: BUTTON_LABELS[lang].payment_succeeded,
  });
}

function paymentFailed(lang, values) {
  const amount = money(values);
  const retryAt = param(values, "retryAt");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Не удалось списать оплату в ${product}`,
      body: [`Платёж на ${amount} не прошёл. Повторим попытку ${retryAt}.`],
      action: "Обновить способ оплаты:",
      notice:
        "Если повтор не пройдёт, платные функции станут недоступны, данные останутся на месте.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].payment_failed,
    });
  }

  return notification(lang, {
    subject: `We couldn't charge your payment method for ${product}`,
    body: [`The ${amount} payment didn't go through. We'll retry on ${retryAt}.`],
    action: "Update payment method:",
    notice:
      "If the retry fails, paid features become unavailable; your data stays where it is.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].payment_failed,
  });
}

function trialEnding(lang, values) {
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Пробный период в ${product} заканчивается ${date}`,
      body: [`Пробный период в ${product} заканчивается ${date}.`],
      action: "Выбрать тариф:",
      notice: "Если тариф не выбрать, организация перейдёт на Free. Данные останутся на месте.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].trial_ending,
    });
  }

  return notification(lang, {
    subject: `Your ${product} trial ends on ${date}`,
    body: [`Your trial ends on ${date}.`],
    action: "Choose a plan:",
    notice: "Without a plan the organisation moves to Free. Your data stays where it is.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].trial_ending,
  });
}

function renewalUpcoming(lang, values) {
  const date = param(values, "date");
  const amount = money(values);
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Годовая подписка ${product} продлится ${date}`,
      body: [`${date} годовая подписка продлится на ${amount}.`],
      action: "Проверить подписку:",
      notice:
        "Продление произойдёт автоматически. Отключить автоплатёж можно в разделе «Тариф и оплата».",
      link: billingUrl,
      label: BUTTON_LABELS[lang].renewal_upcoming,
    });
  }

  return notification(lang, {
    subject: `Your yearly ${product} subscription renews on ${date}`,
    body: [`On ${date} your yearly subscription renews for ${amount}.`],
    action: "Review subscription:",
    notice:
      "The renewal happens automatically. You can turn off auto-payment under plan and payment settings.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].renewal_upcoming,
  });
}

function subscriptionSuspended(lang, values) {
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Подписка ${product} приостановлена`,
      body: [
        "Оплата не прошла, поэтому права организации понижены до Free.",
        "Данные, комнаты и участники на месте — доступ вернётся сразу после оплаты.",
      ],
      action: "Восстановить доступ:",
      notice:
        "Лишние комнаты и участники стали доступны только для чтения, ничего не удалено.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].subscription_suspended,
    });
  }

  return notification(lang, {
    subject: `Your ${product} subscription is suspended`,
    body: [
      "The payment didn't go through, so the organisation's rights are now Free.",
      "Your data, rooms and members are still here — access returns as soon as you pay.",
    ],
    action: "Restore access:",
    notice: "Rooms and members above the Free limits are read-only; nothing was deleted.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].subscription_suspended,
  });
}

function subscriptionCanceled(lang, values) {
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Подписка ${product} закончилась`,
      body: [
        `Подписка закончилась ${date}.`,
        "Права организации теперь как у Free. Данные на месте.",
      ],
      action: "Возобновить подписку:",
      notice: "Вы можете возобновить подписку в любой момент.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].subscription_canceled,
    });
  }

  return notification(lang, {
    subject: `Your ${product} subscription has ended`,
    body: [
      `The subscription ended on ${date}.`,
      "The organisation now has Free rights. Your data is still here.",
    ],
    action: "Resume subscription:",
    notice: "You can resume the subscription at any time.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].subscription_canceled,
  });
}

function paymentMethodExpiring(lang, values) {
  const last4 = param(values, "last4");
  const expMonth = param(values, "expMonth");
  const expYear = param(values, "expYear");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Срок карты в ${product} истекает`,
      body: [`Срок карты •••• ${last4} истекает в ${expMonth}/${expYear}.`],
      action: "Обновить карту:",
      notice: "Если карта уже обновлена у платёжного сервиса, ничего делать не нужно.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].payment_method_expiring,
    });
  }

  return notification(lang, {
    subject: `The card on your ${product} subscription expires soon`,
    body: [`The card ending in ${last4} expires ${expMonth}/${expYear}.`],
    action: "Update card:",
    notice: "If the card is already updated with the payment provider, nothing needs doing.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].payment_method_expiring,
  });
}

function priceChange(lang, values) {
  const oldAmount = money(values, "oldAmount");
  const newAmount = money(values, "newAmount");
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Новая цена подписки ${product}`,
      body: [`С ${date} подписка будет стоить ${newAmount} вместо ${oldAmount}.`],
      action: "Посмотреть условия:",
      notice: "Новая цена применяется при первом продлении после этой даты.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].price_change,
    });
  }

  return notification(lang, {
    subject: `A new price for your ${product} subscription`,
    body: [`From ${date} the subscription will cost ${newAmount} instead of ${oldAmount}.`],
    action: "Review terms:",
    notice: "The new price applies at the first renewal after that date.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].price_change,
  });
}

function paymentMethodMigrate(lang, values) {
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Введите карту заново в ${product}`,
      body: [
        `Платёжное подключение, через которое вы платили, выводится из работы с ${date}.`,
        "Введите карту заново, чтобы подписка продолжилась.",
      ],
      action: "Ввести карту заново:",
      notice: "Данные карты вводятся на стороне платёжного сервиса и к нам не попадают.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].payment_method_migrate,
    });
  }

  return notification(lang, {
    subject: `Enter your card again for ${product}`,
    body: [
      `The payment connection you used is being retired on ${date}.`,
      "Enter your card again so the subscription continues.",
    ],
    action: "Enter card again:",
    notice: "Card details are entered on the payment provider's side and never reach us.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].payment_method_migrate,
  });
}

const RENDERERS = {
  verify_email: verifyEmail,
  password_reset: passwordReset,
  password_changed: passwordChanged,
  invitation,
  payment_succeeded: paymentSucceeded,
  payment_failed: paymentFailed,
  trial_ending: trialEnding,
  renewal_upcoming: renewalUpcoming,
  subscription_suspended: subscriptionSuspended,
  subscription_canceled: subscriptionCanceled,
  payment_method_expiring: paymentMethodExpiring,
  price_change: priceChange,
  payment_method_migrate: paymentMethodMigrate,
};

/**
 * @param {"verify_email"|"password_reset"|"password_changed"|"invitation"|"payment_succeeded"|"payment_failed"|"trial_ending"|"renewal_upcoming"|"subscription_suspended"|"subscription_canceled"|"payment_method_expiring"|"price_change"|"payment_method_migrate"} template
 * @param {"ru"|"en"} locale
 * @param {Record<string, unknown>} params
 * @returns {{ subject: string, text: string, html: string }}
 */
export function render(template, locale, params = {}) {
  if (!MAIL_TEMPLATES.includes(template)) {
    throw templateError("UNKNOWN_TEMPLATE");
  }
  const lang = typeof locale === "string" ? locale.toLowerCase() : "";
  if (!LOCALES.includes(lang)) {
    throw templateError("UNKNOWN_LOCALE");
  }
  const values = params && typeof params === "object" ? params : {};
  // The product name belongs to the installation, not to each call site.
  const product = param(values, "product", { required: false }) ?? "remo";
  return RENDERERS[template](lang, { ...values, product });
}
