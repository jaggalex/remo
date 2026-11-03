import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type AgentSkill, type AgentToken } from "./api";
import { formatMoment } from "./format";
import { useI18n } from "./i18n";
import { AiCredentials } from "./AiCredentials";
import { AiJournal } from "./AiJournal";

/**
 * Agents in the organisation panel.
 *
 * An agent is a principal owned by one person: the list shows whose it is, whether it
 * is enabled, and the keys it uses. The organisation switch is the kill switch; a
 * board owner still has to allow agents on the board itself (spec/AI-agents-v1.md §3).
 */
export function AgentsPanel({
  orgId,
  isOrgAdmin,
  canReadJournal,
  meId,
}: {
  orgId: string;
  isOrgAdmin: boolean;
  canReadJournal: boolean;
  meId: string;
}) {
  const { t, lang } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  /** Which agent's keys are open. */
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [policy, list, catalog] = await Promise.all([
        api.agentPolicy(orgId),
        api.agents(orgId),
        api.skills(orgId),
      ]);
      setEnabled(policy.agentsEnabled);
      setAgents(list.agents);
      setSkills(catalog.skills);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("agents.failed"));
    } finally {
      setLoading(false);
    }
  }, [orgId, t]);

  useEffect(() => {
    void refresh();
    setOpenAgent(null);
    setSecret(null);
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("agents.failed"));
    } finally {
      setBusy(false);
    }
  };

  const openTokens = async (agentId: string) => {
    if (openAgent === agentId) {
      setOpenAgent(null);
      return;
    }
    setOpenAgent(agentId);
    setSecret(null);
    try {
      setTokens((await api.agentTokens(agentId)).tokens);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("agents.failed"));
    }
  };

  return (
    <div className="org-agents">
      <div className="org-agents-head">
        <div>
          <strong>{t("agents.title")}</strong>
          <p className="muted">{t("agents.body")}</p>
        </div>
        {isOrgAdmin && (
          <label className="org-agents-switch">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.checked;
                void run(async () => {
                  await api.setAgentPolicy(orgId, next);
                });
              }}
            />
            {t("agents.orgSwitch")}
          </label>
        )}
      </div>

      {error && <p className="auth-error">{error}</p>}

      {!enabled ? (
        <p className="muted">
          {isOrgAdmin ? t("agents.disabledAdmin") : t("agents.disabledMember")}
        </p>
      ) : (
        <>
          <form
            className="org-invite"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void run(async () => {
                await api.createAgent(orgId, name.trim());
                setName("");
              });
            }}
          >
            <input
              value={name}
              placeholder={t("agents.namePlaceholder")}
              aria-label={t("agents.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="primary-button" disabled={busy || !name.trim()}>
              {t("agents.create")}
            </button>
          </form>

          <ul className="org-agent-list">
            {agents.map((agent) => {
              const own = agent.owner_id === meId;
              const canManage = own || isOrgAdmin;
              return (
                <li key={agent.id} className="org-agent">
                  <div className="org-agent-main">
                    <span className="org-avatar" aria-hidden="true">
                      ✦
                    </span>
                    <div className="org-agent-name">
                      <div>
                        <strong>{agent.name}</strong>
                        <span className={`org-badge ${agent.state === "active" ? "agent" : "suspended"}`}>
                          {agent.state === "active" ? t("agents.active") : t("agents.disabled")}
                        </span>
                        {own && <span className="org-badge you">{t("org.you")}</span>}
                      </div>
                      <span className="muted">
                        {agent.owner_name ?? agent.owner_email ?? ""}
                        {agent.active_tokens
                          ? ` · ${t("agents.keys", { n: agent.active_tokens })}`
                          : ""}
                      </span>
                    </div>
                    {canManage && (
                      <div className="org-person-actions">
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={openAgent === agent.id}
                          onClick={() => void openTokens(agent.id)}
                        >
                          {t("agents.keysAction")}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api.updateAgent(agent.id, {
                                state: agent.state === "active" ? "disabled" : "active",
                              }),
                            )
                          }
                        >
                          {agent.state === "active" ? t("agents.disable") : t("agents.enable")}
                        </button>
                      </div>
                    )}
                  </div>

                  {openAgent === agent.id && (
                    <div className="org-agent-tokens">
                      <div className="org-agent-tokens-head">
                        <strong>{t("agents.tokens")}</strong>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const created = await api.createAgentToken(agent.id, {
                                label: t("agents.tokenLabel"),
                                expiresInDays: 30,
                              });
                              setSecret(created.secret);
                              setCopied(false);
                              setTokens((await api.agentTokens(agent.id)).tokens);
                            })
                          }
                        >
                          {t("agents.newToken")}
                        </button>
                      </div>
                      {secret && (
                        <div className="share-invite">
                          <p className="muted">{t("agents.secretOnce")}</p>
                          <div className="share-link-url">
                            <input readOnly value={secret} onFocus={(event) => event.target.select()} />
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(secret);
                                setCopied(true);
                              }}
                            >
                              {copied ? t("agents.copied") : t("agents.copy")}
                            </button>
                          </div>
                        </div>
                      )}
                      <ul className="org-token-list">
                        {tokens.map((token) => (
                          <li key={token.id}>
                            <span>{token.label || token.id.slice(0, 8)}</span>
                            <span className="muted">
                              {token.revoked_at
                                ? t("agents.revoked")
                                : t("agents.expires", { date: formatMoment(token.expires_at, lang) })}
                            </span>
                            {!token.revoked_at && (
                              <button
                                type="button"
                                className="link-button danger"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api.revokeAgentToken(agent.id, token.id);
                                    setTokens((await api.agentTokens(agent.id)).tokens);
                                  })
                                }
                              >
                                {t("agents.revoke")}
                              </button>
                            )}
                          </li>
                        ))}
                        {!tokens.length && <li className="muted">{t("agents.noTokens")}</li>}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
            {!agents.length && !loading && <li className="muted">{t("agents.empty")}</li>}
          </ul>

          <div className="org-skills">
            <strong>{t("agents.skills")}</strong>
            <p className="muted">{t("agents.skillsNote")}</p>
            <ul>
              {skills.map((skill) => (
                <li key={skill.id}>
                  <span>{skill.name}</span>
                  <span className="muted">
                    {skill.slug}@{skill.version} · {t(`agents.risk.${skill.risk}` as "agents.risk.read")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <AiCredentials orgId={orgId} isOrgAdmin={isOrgAdmin} />
      {canReadJournal && <AiJournal orgId={orgId} />}
    </div>
  );
}
