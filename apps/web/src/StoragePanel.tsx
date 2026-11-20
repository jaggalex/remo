import { useEffect, useState } from "react";
import { Button } from "@remo/ui";
import { billingApi, type OrgBilling } from "./apiBilling";
import { useI18n } from "./i18n";
import { formatStorageBytes, storageShare, storageTone } from "./storageUsage";

/**
 * "Storage": how much of the organisation's image quota is gone (ADR-249 §7,
 * `spec/images.md` §9.8).
 *
 * The numbers come from the billing summary the screen already reads, so this tab never
 * asks a second route and cannot disagree with the plan tab about the same organisation.
 * It shows a fact and, for an owner, the one action that changes the ceiling; a member
 * without the role is told who to ask, exactly like the plan tab (`spec/billing.md` §3.2).
 *
 * The bar's thresholds are the ones §9.8 names: accent under 80 %, warning up to 100 %,
 * danger at the ceiling. `null` is "no limit", not zero — the self-host answer — and then
 * there is no bar to fill.
 */
export function StoragePanel({
  orgId,
  summary,
  isOrgAdmin,
  onSeePlans,
}: {
  orgId: string;
  /** The dialog's probe; when it has not answered, the panel reads the route itself. */
  summary: OrgBilling | null;
  isOrgAdmin: boolean;
  /** The plan tab next door, where the ceiling can be changed. */
  onSeePlans: () => void;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<OrgBilling | null>(summary);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (summary) {
      setData(summary);
      return;
    }
    setData(null);
    let alive = true;
    billingApi
      .org(orgId)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((failure: unknown) => {
        if (!alive) return;
        setError(failure instanceof Error ? failure.message : t("storage.failed"));
      });
    return () => {
      alive = false;
    };
  }, [orgId, summary, t]);

  if (error) return <p className="auth-error">{error}</p>;
  if (!data) return <p className="muted">{t("storage.loading")}</p>;

  // The field is part of the contract; the fallback only keeps an older server readable
  // and means the same thing as an organisation with no files.
  const { usedBytes, limitBytes } = data.storage ?? { usedBytes: 0, limitBytes: null };
  const share = storageShare(usedBytes, limitBytes);
  const percent = Math.round(share * 100);
  const used = formatStorageBytes(usedBytes, lang);
  const limit = limitBytes === null ? null : formatStorageBytes(limitBytes, lang);

  return (
    <section className="storage-panel">
      <p className="storage-summary">
        {limit === null
          ? t("storage.usedUnlimited", { used })
          : t("storage.used", { used, limit })}
      </p>

      {limit !== null && (
        <div
          className="storage-bar"
          role="progressbar"
          aria-label={t("storage.tab")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={t("storage.used", { used, limit })}
        >
          <span
            className={`storage-bar-fill is-${storageTone(share)}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {limit !== null &&
        (isOrgAdmin ? (
          <div className="storage-actions">
            <Button variant="primary" size="compact" onClick={onSeePlans}>
              {t("billing.seePlans")}
            </Button>
          </div>
        ) : (
          <p className="muted">{t("billing.askOwner")}</p>
        ))}

      <p className="muted">{t("storage.gc")}</p>
    </section>
  );
}
