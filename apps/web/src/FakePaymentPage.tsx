/**
 * The development payment provider's page (ADR-248 §7, `spec/payment-providers.md` §7).
 *
 * A real provider sends the payer to its own hosted page; the fake adapter sends them
 * here with `?fake_pay=<paymentId>`. The page has two buttons, because the two outcomes
 * are what a checkout test needs to see. It is not a mock of the screen: the amount and
 * the availability come from the server, and the completion call goes through the same
 * ledger path an operator's mark-paid command uses.
 *
 * `/billing/fake/*` answers `404` unless the installation has the gate on
 * (`NODE_ENV !== "production"` and `REMO_PAY_FAKE=1`), so the page states "not available"
 * instead of rendering a dead form.
 */
import { useEffect, useState } from "react";
import { Button } from "@remo/ui";
import { ApiError, call } from "./apiCall";
import { formatMoney } from "./apiBilling";
import { useI18n } from "./i18n";

type Outcome = "success" | "fail";
type Status = "pending" | "succeeded" | "failed" | "canceled";

interface FakePayment {
  paymentId: string;
  invoiceId: string;
  status: Status;
  amount: number;
  currency: string;
}

export function FakePaymentPage({ paymentId }: { paymentId: string }) {
  const { t, lang } = useI18n();
  const [payment, setPayment] = useState<FakePayment | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    call<FakePayment>(`/billing/fake/payment/${encodeURIComponent(paymentId)}`)
      .then((answer) => {
        if (alive) setPayment(answer);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // The route is absent when the gate is off; that is a state of the installation,
        // not a broken request, and gets its own sentence.
        if (error instanceof ApiError && error.status === 404) setUnavailable(true);
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [paymentId]);

  const complete = async (outcome: Outcome) => {
    setBusy(outcome);
    setFailed(false);
    try {
      await call<{ ok: true }>("/billing/fake/complete", {
        method: "POST",
        body: { paymentId, outcome },
      });
      const next = new URL(window.location.href);
      next.searchParams.delete("fake_pay");
      next.searchParams.set("billing", "return");
      next.searchParams.set("payment", paymentId);
      window.location.assign(next.toString());
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };

  const statusLabel = payment ? t(`fake.status.${payment.status}`) : "";
  const settled = payment ? payment.status !== "pending" : false;

  return (
    <main className="fake-payment">
      <section className="fake-payment-card" aria-labelledby="fake-payment-title">
        <h1 id="fake-payment-title">{t("fake.title")}</h1>
        <p className="fake-payment-hint">{t("fake.hint")}</p>

        {unavailable && <p className="fake-payment-note">{t("fake.unavailable")}</p>}
        {failed && (
          <p className="fake-payment-error" role="alert">
            {t("fake.error")}
          </p>
        )}

        {payment && (
          <>
            <dl className="fake-payment-facts">
              <div>
                <dt>{t("fake.amount")}</dt>
                <dd>{formatMoney(payment.amount, payment.currency, lang)}</dd>
              </div>
              <div>
                <dt>{t("fake.statusLabel")}</dt>
                <dd>{statusLabel}</dd>
              </div>
            </dl>
            {settled ? (
              <p className="fake-payment-note">{t("fake.finished")}</p>
            ) : (
              <div className="fake-payment-actions">
                <Button
                  variant="primary"
                  loading={busy === "success"}
                  disabled={busy !== null}
                  onClick={() => void complete("success")}
                >
                  {t("fake.success")}
                </Button>
                <Button
                  loading={busy === "fail"}
                  disabled={busy !== null}
                  onClick={() => void complete("fail")}
                >
                  {t("fake.fail")}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
