import type { PlanWarning } from "@remo/doc";
import { Badge } from "@remo/ui";
import { isCriticalWarning, warningText } from "./agentPlanText";
import { useI18n } from "./i18n";

/**
 * Warnings as a list with their code, not a single paragraph (ADR-142, M3).
 *
 * The code is the same one the server promises, so a person can quote it; the
 * sentence is ours, because a model's warning wording is untrusted data. Critical
 * rows carry a danger badge and one sentence that says what to do about them.
 */
export function AgentPlanWarnings({ warnings }: { warnings: PlanWarning[] }) {
  const { t } = useI18n();
  if (!warnings.length) return null;

  return (
    <section
      className="agent-plan-section"
      aria-label={t("agents.plan.warnings", { n: warnings.length })}
    >
      <strong>{t("agents.plan.warnings", { n: warnings.length })}</strong>
      <ul className="agent-plan-warning-list">
        {warnings.map((warning, index) => {
          const isCritical = isCriticalWarning(warning);
          return (
            <li
              key={`${warning.code}-${warning.tempId ?? ""}-${index}`}
              className={isCritical ? "is-critical" : undefined}
            >
              <Badge tone={isCritical ? "danger" : "warning"}>
                {isCritical ? t("agents.plan.severity.critical") : t("agents.plan.severity.warning")}
              </Badge>
              <code className="agent-plan-warning-code">{warning.code}</code>
              <span className="agent-plan-warning-text">{warningText(warning, t)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
