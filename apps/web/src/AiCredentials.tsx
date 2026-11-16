import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Input, Select } from "@remo/ui";
import { api, type AiCredential, type AiPolicy } from "./api";
import { useI18n } from "./i18n";

/**
 * Provider keys: one set for the person, one for the organisation.
 *
 * A secret is write-only: it goes up once and comes back as a fingerprint. Neither an
 * organisation admin nor support can read it; the service decrypts it only while a task
 * runs (spec/AI-agents-architecture.md).
 */
export function AiCredentials({
  orgId,
  isOrgAdmin,
}: {
  orgId: string;
  isOrgAdmin: boolean;
}) {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<AiPolicy>({
    keyMode: "either",
    providers: [],
    models: [],
  });
  const [personal, setPersonal] = useState<AiCredential[]>([]);
  const [orgKeys, setOrgKeys] = useState<AiCredential[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<"personal" | "org" | null>(null);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextPolicy, mine, org] = await Promise.all([
        api.aiPolicy(orgId),
        api.userCredentials(),
        isOrgAdmin ? api.orgCredentials(orgId) : Promise.resolve({ credentials: [] }),
      ]);
      setPolicy(nextPolicy.policy);
      setPersonal(mine.credentials);
      setOrgKeys(org.credentials);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("aiKeys.failed"));
    }
  }, [orgId, isOrgAdmin, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("aiKeys.failed"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (scope: "personal" | "org") => {
    if (!secret.trim()) return;
    void run(async () => {
      const body = {
        provider,
        secret: secret.trim(),
        label: label.trim() || undefined,
        model: model.trim() || undefined,
        baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
      };
      if (scope === "personal") await api.createUserCredential(body);
      else await api.createOrgCredential(orgId, body);
      setSecret("");
      setLabel("");
      setModel("");
      setBaseUrl("");
      setForm(null);
      setNotice(t("aiKeys.saved"));
    });
  };

  const rows = (list: AiCredential[], scope: "personal" | "org") =>
    list.map((key) => (
      <li key={key.id} className="ai-key">
        <div className="ai-key-main">
          <strong>{key.provider}</strong>
          <span className="muted">
            {key.model || t("aiKeys.noModel")} · {key.fingerprint}
            {key.isDefault ? ` · ${t("aiKeys.default")}` : ""}
          </span>
        </div>
        <div className="ai-key-actions">
          <Button variant="ghost" size="compact"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (scope === "personal") await api.testUserCredential(key.id);
                else await api.testOrgCredential(orgId, key.id);
                setNotice(t("aiKeys.tested"));
              })
            }>
            {t("aiKeys.test")}
          </Button>
          {!key.isDefault && (
            <Button variant="ghost" size="compact"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (scope === "personal") await api.defaultUserCredential(key.id);
                  else await api.orgCredentialDefault(orgId, key.id);
                })
              }>
              {t("aiKeys.default")}
            </Button>
          )}
          <Button variant="ghost" size="compact"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (scope === "personal") await api.deleteUserCredential(key.id);
                else await api.deleteOrgCredential(orgId, key.id);
              })
            }>
            {t("aiKeys.revoke")}
          </Button>
        </div>
      </li>
    ));

  return (
    <div className="ai-keys">
      <div className="org-agents-head">
        <div>
          <strong>{t("aiKeys.title")}</strong>
          <p className="muted">{t("aiKeys.body")}</p>
        </div>
      </div>

      <Banner tone="warning" title={t("aiKeys.safetyTitle")}>
        {t("aiKeys.safetyBody")}
      </Banner>

      {error && <p className="auth-error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {isOrgAdmin && (
        <Select
          label={t("aiKeys.mode")}
          options={[
            { value: "either", label: t("aiKeys.modeEither") },
            { value: "org", label: t("aiKeys.modeOrg") },
            { value: "personal", label: t("aiKeys.modePersonal") },
          ]}
            value={policy.keyMode}
            disabled={busy}
            onChange={(event) =>
              void run(async () => {
                await api.setAiPolicy(orgId, {
                  ...policy,
                  keyMode: event.target.value as AiPolicy["keyMode"],
                });
              })
            }
          />
      )}

      <section className="ai-key-section">
        <div className="ai-key-head">
          <strong>{t("aiKeys.orgTitle")}</strong>
          {isOrgAdmin && (
            <Button
              onClick={() => setForm(form === "org" ? null : "org")}>
              {t("aiKeys.add")}
            </Button>
          )}
        </div>
        {form === "org" && isOrgAdmin && keyForm("org")}
        <ul>{rows(orgKeys, "org")}</ul>
        {!orgKeys.length && <p className="muted">{t("aiKeys.emptyOrg")}</p>}
      </section>

      <section className="ai-key-section">
        <div className="ai-key-head">
          <strong>{t("aiKeys.personalTitle")}</strong>
          <Button
            onClick={() => setForm(form === "personal" ? null : "personal")}>
            {t("aiKeys.add")}
          </Button>
        </div>
        {form === "personal" && keyForm("personal")}
        <ul>{rows(personal, "personal")}</ul>
        {!personal.length && <p className="muted">{t("aiKeys.emptyPersonal")}</p>}
      </section>

      <p className="muted ai-key-note">{t("aiKeys.note")}</p>
    </div>
  );

  function keyForm(scope: "personal" | "org") {
    return (
      <form
        className="ai-key-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          submit(scope);
        }}
      >
        <div className="agent-budget">
          <Select
            label={t("aiKeys.provider")}
            value={provider}
            options={[
              { value: "openrouter", label: "OpenRouter" },
              { value: "cerebras", label: "Cerebras" },
              { value: "openai", label: "OpenAI" },
              { value: "custom", label: t("aiKeys.custom") },
            ]}
            onChange={(event) => setProvider(event.target.value)}
          />
          <Input
            label={t("aiKeys.model")}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="openai/gpt-4o-mini"
            />
        </div>
        {provider === "custom" && (
          <Input
            label={t("aiKeys.baseUrl")}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://gateway.example.com/v1"
            />
        )}
        <Input label={t("aiKeys.label")} value={label} onChange={(event) => setLabel(event.target.value)} />
        <Input
          label={t("aiKeys.secret")}
            type="password"
            name="providerSecret"
            autoComplete="new-password"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="sk-…"
          />
        <div className="agent-actions">
          <span className="muted">{t("aiKeys.secretNote")}</span>
          <Button variant="primary"
            disabled={busy || !secret.trim()}
            onClick={() => submit(scope)}>
            {t("aiKeys.save")}
          </Button>
        </div>
      </form>
    );
  }
}
