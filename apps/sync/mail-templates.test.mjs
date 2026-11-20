import { describe, expect, it } from "vitest";
import { MAIL_TEMPLATES, render } from "./mail-templates.mjs";

const BILLING_URL = "https://app.example.com/?billing=acme";

const CASES = {
  verify_email: { name: "Анна", link: "https://app.example.com/?verify=tok123" },
  password_reset: { link: "https://app.example.com/?reset=tok456" },
  password_changed: {
    email: "anna@example.com",
    forgotLink: "https://app.example.com/?forgot=1",
  },
  invitation: {
    inviter: "Иван",
    target: "Дизайн",
    targetKind: "organisation",
    expires: "1 декабря 2026",
    link: "https://app.example.com/?invite=inv789",
  },
  payment_succeeded: {
    amount: "290,00 ₽",
    currency: "RUB",
    period: "ноябрь 2026",
    invoiceUrl: "https://app.example.com/?invoice=INV-2026-000123",
  },
  payment_failed: {
    amount: "290,00 ₽",
    currency: "RUB",
    retryAt: "24 ноября 2026",
    billingUrl: BILLING_URL,
  },
  trial_ending: { date: "23 ноября 2026", billingUrl: BILLING_URL },
  renewal_upcoming: {
    date: "27 ноября 2026",
    amount: "29 000,00 ₽",
    currency: "RUB",
    billingUrl: BILLING_URL,
  },
  subscription_suspended: { billingUrl: BILLING_URL },
  subscription_canceled: { date: "1 декабря 2026", billingUrl: BILLING_URL },
  payment_method_expiring: {
    last4: "4242",
    expMonth: "05",
    expYear: "2027",
    billingUrl: BILLING_URL,
  },
  price_change: {
    oldAmount: "290,00 ₽",
    newAmount: "349,00 ₽",
    currency: "RUB",
    date: "20 декабря 2026",
    billingUrl: BILLING_URL,
  },
  payment_method_migrate: { date: "1 января 2027", billingUrl: BILLING_URL },
};

const LINK_PARAMS = {
  password_changed: "forgotLink",
  payment_succeeded: "invoiceUrl",
};

function linkOf(template, params) {
  return params[LINK_PARAMS[template] ?? "billingUrl"] ?? params.link;
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe("MAIL_TEMPLATES", () => {
  it("lists every template of the spec, auth and billing", () => {
    expect(MAIL_TEMPLATES).toEqual([
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
    ]);
  });
});

describe("render", () => {
  for (const template of MAIL_TEMPLATES) {
    for (const locale of ["ru", "en"]) {
      it(`renders ${template} in ${locale} with text and a clickable link`, () => {
        const params = CASES[template];
        const link = linkOf(template, params);
        const mail = render(template, locale, params);

        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text.length).toBeGreaterThan(0);
        expect(mail.html.length).toBeGreaterThan(0);

        // A plain-text reader is not a second-class reader: the same link must work there.
        expect(mail.text).toContain(link);
        expect(mail.html).toContain(link);
        expect(mail.html).toContain(`href="${link}"`);

        for (const part of [mail.subject, mail.text, mail.html]) {
          expect(part).not.toMatch(/undefined|\[object Object\]/);
        }
      });
    }
  }

  it("escapes substitutions in HTML but not in the subject", () => {
    const mail = render("verify_email", "ru", {
      name: "<script>alert(1)</script>",
      link: CASES.verify_email.link,
      product: 'A & B "quoted"',
    });

    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("A &amp; B &quot;quoted&quot;");
    expect(mail.subject).toContain("A & B");
  });

  it("escapes the invitation target and keeps its quotes intact in text", () => {
    const params = { ...CASES.invitation, target: 'R&D "room"' };
    const mail = render("invitation", "en", params);

    expect(mail.html).toContain("R&amp;D &quot;room&quot;");
    expect(mail.html).not.toContain('R&D "room"');
    expect(mail.text).toContain('R&D "room"');
  });

  it("has no external images or fonts", () => {
    for (const template of MAIL_TEMPLATES) {
      const mail = render(template, "ru", CASES[template]);
      expect(mail.html).not.toContain("<img");
      expect(mail.html).not.toContain("@font-face");
      expect(mail.html).not.toContain("http://fonts");
    }
  });

  it("uses a neutral greeting when the name is absent", () => {
    const ru = render("verify_email", "ru", { link: CASES.verify_email.link });
    const en = render("verify_email", "en", { link: CASES.verify_email.link });

    expect(ru.text.startsWith("Здравствуйте!")).toBe(true);
    expect(en.text.startsWith("Hi,")).toBe(true);
    expect(ru.text).not.toContain("undefined");
    expect(en.text).not.toContain("undefined");
  });

  it("defaults the product name to remo", () => {
    const mail = render("password_reset", "en", { link: CASES.password_reset.link });
    expect(mail.subject).toBe("Reset your remo password");
  });

  it("localises the invitation target kind", () => {
    const room = { ...CASES.invitation, targetKind: "room" };
    expect(render("invitation", "ru", room).text).toContain("в комнату «Дизайн»");
    expect(render("invitation", "en", room).text).toContain('the room "Дизайн"');

    const organisation = { ...CASES.invitation, targetKind: "organisation" };
    expect(render("invitation", "ru", organisation).text).toContain(
      "в организацию «Дизайн»",
    );
    expect(render("invitation", "en", organisation).text).toContain(
      'the organisation "Дизайн"',
    );
  });

  it("removes line breaks from single-line fields", () => {
    const mail = render("invitation", "ru", {
      ...CASES.invitation,
      inviter: "Иван\nBcc: evil@example.com",
      target: "Дизайн\r\nОтдел",
    });
    expect(mail.subject).not.toContain("\n");
    expect(mail.text).not.toContain("\nBcc:");
    expect(mail.text).toContain("Иван Bcc: evil@example.com");
    expect(mail.subject).not.toContain("\r");
  });

  it("rejects an unknown template", () => {
    expect(errorOf(() => render("welcome", "ru", {})).code).toBe("UNKNOWN_TEMPLATE");
  });

  it("rejects an unknown or missing locale", () => {
    const link = CASES.password_reset.link;
    expect(errorOf(() => render("password_reset", "de", { link })).code).toBe(
      "UNKNOWN_LOCALE",
    );
    expect(errorOf(() => render("password_reset", undefined, { link })).code).toBe(
      "UNKNOWN_LOCALE",
    );
  });

  it("names the missing parameter", () => {
    const error = errorOf(() => render("password_reset", "ru", {}));
    expect(error.code).toBe("MISSING_PARAM");
    expect(error.param).toBe("link");

    const changed = errorOf(() =>
      render("password_changed", "en", { forgotLink: CASES.password_changed.forgotLink }),
    );
    expect(changed.code).toBe("MISSING_PARAM");
    expect(changed.param).toBe("email");

    const invite = errorOf(() =>
      render("invitation", "ru", { ...CASES.invitation, target: undefined }),
    );
    expect(invite.code).toBe("MISSING_PARAM");
    expect(invite.param).toBe("target");
  });

  it("treats an object where a required string belongs as a missing parameter", () => {
    const error = errorOf(() =>
      render("verify_email", "ru", {
        link: { href: "https://app.example.com" },
      }),
    );
    expect(error.code).toBe("MISSING_PARAM");
    expect(error.param).toBe("link");
  });

  it("ignores an optional name that is not text", () => {
    const mail = render("verify_email", "ru", {
      name: { toString: () => "object" },
      link: CASES.verify_email.link,
    });
    expect(mail.text.startsWith("Здравствуйте!")).toBe(true);
    expect(mail.text).not.toContain("[object Object]");
  });
});

describe("billing templates", () => {
  const TEMPLATES = [
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

  // The caller formats the sum; the template must print it unchanged and never invent
  // a currency of its own.
  const SUMS = {
    payment_succeeded: ["290,00 ₽"],
    payment_failed: ["290,00 ₽"],
    renewal_upcoming: ["29 000,00 ₽"],
    price_change: ["290,00 ₽", "349,00 ₽"],
  };

  for (const template of TEMPLATES) {
    for (const locale of ["ru", "en"]) {
      it(`renders ${template} in ${locale} with its sum and link`, () => {
        const params = CASES[template];
        const link = linkOf(template, params);
        const mail = render(template, locale, params);

        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text.length).toBeGreaterThan(0);
        expect(mail.html.length).toBeGreaterThan(0);
        expect(mail.text).toContain(link);
        expect(mail.html).toContain(`href="${link}"`);

        for (const sum of SUMS[template] ?? []) {
          expect(mail.text).toContain(sum);
          expect(mail.html).toContain(sum);
        }
      });
    }
  }

  it("uses the retry date and the card details it was given", () => {
    expect(render("payment_failed", "ru", CASES.payment_failed).text).toContain(
      CASES.payment_failed.retryAt,
    );
    const card = render("payment_method_expiring", "en", CASES.payment_method_expiring);
    expect(card.text).toContain("4242");
    expect(card.text).toContain("05/2027");
  });

  it("escapes billing substitutions in HTML but not in text", () => {
    const mail = render("payment_succeeded", "ru", {
      ...CASES.payment_succeeded,
      amount: "</p><script>alert(1)</script>",
      period: 'R&D "year"',
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("R&amp;D &quot;year&quot;");
    expect(mail.text).toContain("<script>");
    expect(mail.text).toContain('R&D "year"');
  });

  it("refuses a sum without its ISO currency code", () => {
    const error = errorOf(() =>
      render("payment_succeeded", "en", {
        ...CASES.payment_succeeded,
        currency: undefined,
      }),
    );
    expect(error.code).toBe("MISSING_PARAM");
    expect(error.param).toBe("currency");
  });
});
