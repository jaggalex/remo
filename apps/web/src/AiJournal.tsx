import { Button, Select } from "@remo/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AiChainCheck, type AiRun } from "./api";
import { formatMoment } from "./format";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";

/**
 * The evidential journal, as an administrator sees it.
 *
 * It shows parameters, not prompts: provider, model, key fingerprint, tokens, cost and
 * whether the hash chain still verifies. Recomputing the chain is a button, not a
 * background guess, because the answer is a claim about the record itself. Filters are
 * client-side: the journal is an organisation's own history and the list is already
 * bounded by the API.
 */
export function AiJournal({ orgId }: { orgId: string }) {
  const { t, lang } = useI18n();
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [anchor, setAnchor] = useState<AiChainCheck["anchor"]>(null);
  const [check, setCheck] = useState<AiChainCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState("all");
  const [outcome, setOutcome] = useState<"all" | "ok" | "error">("all");

  const load = useCallback(async () => {
    try {
      const result = await api.aiRuns(orgId);
      setRuns(result.runs);
      setAnchor(result.anchor);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("aiLog.failed"));
    }
  }, [orgId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = async () => {
    setBusy(true);
    try {
      setCheck(await api.verifyAiRuns(orgId));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("aiLog.failed"));
    } finally {
      setBusy(false);
    }
  };

  const skills = useMemo(
    () => [...new Set(runs.map((run) => run.skill).filter((value): value is string => !!value))],
    [runs],
  );

  const visible = useMemo(
    () =>
      runs.filter((run) => {
        if (skill !== "all" && run.skill !== skill) return false;
        const failed = !!run.error_code || run.status === "failed";
        if (outcome === "ok" && failed) return false;
        if (outcome === "error" && !failed) return false;
        return true;
      }),
    [runs, skill, outcome],
  );

  return (
    <div className="ai-journal">
      <div className="org-agents-head">
        <div>
          <strong>
            {t("aiLog.title")} <HelpLink topicId="agents.journal" />
          </strong>
          <p className="muted">{t("aiLog.body")}</p>
        </div>
        <Button disabled={busy} onClick={() => void verify()}>
          {t("aiLog.verify")}
        </Button>
      </div>

      {error && <p className="auth-error">{error}</p>}

      {check && (
        <p className={check.ok ? "muted ai-log-ok" : "auth-error"}>
          {check.ok
            ? t("aiLog.ok", { n: check.checked })
            : t("aiLog.broken", { seq: check.brokenAt ?? "?", reason: check.reason ?? "" })}
        </p>
      )}
      {anchor && (
        <p className="muted">
          {t("aiLog.anchor", {
            seq: anchor.seq,
            date: formatMoment(anchor.created_at, lang),
            where: anchor.destination,
          })}
        </p>
      )}

      <div className="ai-log-filters">
        <Select
          size="compact"
          label={t("aiLog.filterSkill")}
          options={[
            { value: "all", label: t("aiLog.allSkills") },
            ...skills.map((value) => ({ value, label: value })),
          ]}
          value={skill}
          onChange={(event) => setSkill(event.target.value)}
        />
        <Select
          size="compact"
          label={t("aiLog.filterOutcome")}
          options={[
            { value: "all", label: t("aiLog.allOutcomes") },
            { value: "ok", label: t("aiLog.onlyOk") },
            { value: "error", label: t("aiLog.onlyErrors") },
          ]}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as typeof outcome)}
        />
        <span className="muted">{t("aiLog.shown", { n: visible.length, total: runs.length })}</span>
      </div>

      <ul className="ai-log-list">
        {visible.slice(0, 20).map((run) => (
          <li key={run.id}>
            <span className="agent-status applied">#{run.seq}</span>
            <div>
              <span>
                {run.skill ?? t("aiLog.noSkill")} · {run.model ?? "—"}
              </span>
              <span className="muted">
                {run.provider ?? "—"} · {run.prompt_tokens + run.completion_tokens} tok · $
                {Number(run.cost_usd).toFixed(4)} · {formatMoment(run.finished_at ?? run.started_at ?? "", lang)}
                {run.error_code ? ` · ${run.error_code}` : ""}
              </span>
            </div>
          </li>
        ))}
        {!visible.length && <li className="muted">{t("aiLog.emptyFiltered")}</li>}
      </ul>
    </div>
  );
}
