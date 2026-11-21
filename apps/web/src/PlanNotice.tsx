import { Button } from "@remo/ui";
import type { PlanLimitNotice } from "./apiBilling";
import { SupportEntryButton } from "./SupportPanel";
import { useI18n, type TranslationKey } from "./i18n";

/**
 * What a `402` means, in one banner (ADR-247 §8.4).
 *
 * The server says which limit or feature refused the action; this component only names
 * it and offers the one action that can change it. A refusal that is not a plan refusal
 * never reaches here — `planLimitFrom` returns null for it, so the ordinary error text
 * stays exactly as it was.
 */

const LIMIT_LABEL: Record<string, { counted: TranslationKey; short: TranslationKey }> = {
  rooms: { counted: "billing.limit.rooms", short: "billing.limit.roomsShort" },
  seats: { counted: "billing.limit.seats", short: "billing.limit.seatsShort" },
  agentTasksPerMonth: {
    counted: "billing.limit.agents",
    short: "billing.limit.agentsShort",
  },
};

const FEATURE_LABEL: Record<string, TranslationKey> = {
  "export.pdf": "billing.feature.export.pdf",
  "export.no_watermark": "billing.feature.export.no_watermark",
  "link.protect": "billing.feature.link.protect",
  "roles.advanced": "billing.feature.roles.advanced",
  integrations: "billing.feature.integrations",
  "agents.unlimited": "billing.feature.agents.unlimited",
};

export function PlanNotice({
  notice,
  onSeePlans,
  onDismiss,
}: {
  notice: PlanLimitNotice;
  /** Absent when billing is switched off on this installation: no dead button. */
  onSeePlans?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();

  let what: string;
  if (notice.kind === "limit") {
    const labels = notice.limit ? LIMIT_LABEL[notice.limit] : undefined;
    if (!labels) {
      what = t("billing.limit.other");
    } else if (notice.current !== undefined && notice.max !== undefined) {
      what = t(labels.counted, { current: notice.current, max: notice.max });
    } else {
      what = t(labels.short);
    }
  } else {
    what = notice.feature
      ? t(FEATURE_LABEL[notice.feature] ?? "billing.feature.other")
      : t("billing.feature.other");
  }

  return (
    <div className="plan-notice" role="status">
      <span>{t("billing.planLimit", { what })}</span>
      <div className="plan-notice-actions">
        {onSeePlans && (
          <Button size="compact" variant="primary" onClick={onSeePlans}>
            {t("billing.seePlans")}
          </Button>
        )}
        {/* A limit is also a question about money, and a person answers that better than
            the plans screen. Absent when the installation has no support (ADR-250). */}
        <SupportEntryButton requireSession variant="ghost">
          {t("support.planQuestion")}
        </SupportEntryButton>
        {onDismiss && (
          <Button size="compact" variant="ghost" onClick={onDismiss}>
            {t("billing.dismiss")}
          </Button>
        )}
      </div>
    </div>
  );
}
