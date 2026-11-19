/**
 * AI credentials: where a provider key lives, who may see it and how it rotates.
 */
import { verifyAiChain } from "./ai-log.mjs";
import { fail, json, readBody } from "./iam-api.mjs";
import {
  PROVIDER_PRESETS,
  SecretError,
  assertPublicDns,
  assertSafeBaseUrl,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  kekFromEnv,
} from "./secrets.mjs";
import { randomUUID } from "node:crypto";
import { safeFetch } from "./outbound.mjs";

export async function handleAiCredentials(ctx) {
  const { request, response, url, parts, method, store, me, audit, isMember, isOrgAdmin } = ctx;

  const credentialView = (row) => ({
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    fingerprint: row.fingerprint,
    isDefault: row.is_default,
    state: row.state,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at,
    lastUsedAt: row.last_used_at,
  });

  const credentialScope = (row, scope, scopeId) =>
    row && row.scope === scope && row.scope_id === scopeId && row.state === "active";

  async function probeProvider(baseUrl, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await safeFetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`provider answered ${response.status}`);
      return true;
    } catch (error) {
      throw new Error(error?.name === "AbortError" ? "provider timed out" : error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  if (
    (parts[0] === "users" && parts[1] === "me" && parts[2] === "ai") ||
    (parts[0] === "orgs" && parts[2] === "ai")
  ) {
    const isUserScope = parts[0] === "users";
    const orgId = isUserScope ? null : parts[1];
    const scope = isUserScope ? "user" : "org";
    const scopeId = isUserScope ? me.id : orgId;
    const suffix = isUserScope ? parts.slice(3) : parts.slice(3);

    if (!isUserScope) {
      if (!(await isMember(orgId))) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
        return true;
      }
    }

    /* policy ------------------------------------------------------------- */

    if (!isUserScope && suffix[0] === "policy" && suffix.length === 1) {
      if (method === "GET") {
        json(response, 200, { policy: await store.getAiPolicy(orgId) });
        return true;
      }
      if (method === "PUT") {
        if (!(await isOrgAdmin(orgId))) {
          fail(response, 403, "FORBIDDEN", "only an organisation admin can change this");
          return true;
        }
        const body = await readBody(request);
        const keyMode = ["either", "org", "personal"].includes(body?.keyMode)
          ? body.keyMode
          : "either";
        const allowedProviders = new Set([...Object.keys(PROVIDER_PRESETS), "custom"]);
        const providers = Array.isArray(body?.providers)
          ? [...new Set(body.providers.map(String))].filter((provider) =>
              allowedProviders.has(provider),
            )
          : [];
        const models = Array.isArray(body?.models)
          ? [...new Set(body.models.map((model) => String(model).slice(0, 120)))].filter(Boolean)
          : [];
        const policy = await store.setAiPolicy(orgId, { keyMode, providers, models });
        await audit({
          orgId,
          action: "ai.policy.update",
          subject: keyMode,
          after: { providers, models },
        });
        json(response, 200, { policy });
        return true;
      }
    }

    /* evidential log ----------------------------------------------------- */

    if (!isUserScope && suffix[0] === "runs") {
      const admin =
        (await isOrgAdmin(orgId)) || (await store.hasOrgRole(orgId, me.id, "security_admin"));
      if (!admin) {
        fail(response, 403, "FORBIDDEN", "only an administrator can read the AI journal");
        return true;
      }
      if (suffix[1] === "verify" && method === "GET") {
        const rows = await store.aiRunsForVerify(orgId);
        const chain = verifyAiChain(rows);
        const anchor = await store.latestAiAnchor(orgId);
        json(response, 200, { ...chain, anchor });
        return true;
      }
      if (suffix.length === 1 && method === "GET") {
        json(response, 200, {
          runs: await store.listAiRuns(
            orgId,
            Number(url.searchParams.get("limit") ?? 50),
          ),
          anchor: await store.latestAiAnchor(orgId),
        });
        return true;
      }
    }

    /* credentials -------------------------------------------------------- */

    if (suffix[0] === "credentials") {
      if (!isUserScope && !(await isOrgAdmin(orgId))) {
        fail(response, 403, "FORBIDDEN", "only an organisation admin can manage this key");
        return true;
      }

      if (suffix.length === 1) {
        if (method === "GET") {
          const rows = await store.listAiCredentials(scope, scopeId);
          json(response, 200, { credentials: rows.map(credentialView) });
          return true;
        }
        if (method === "POST") {
          const body = await readBody(request);
          const provider = String(body?.provider ?? "").trim().toLowerCase();
          if (!PROVIDER_PRESETS[provider] && provider !== "custom") {
            fail(response, 422, "BAD_PROVIDER", "choose a known provider or custom");
            return true;
          }
          const secret = String(body?.secret ?? "");
          if (secret.length < 4 || secret.length > 2048) {
            fail(response, 422, "BAD_SECRET", "the key looks empty or too long");
            return true;
          }
          let baseUrl;
          try {
            if (provider === "custom") {
              baseUrl = assertSafeBaseUrl(body?.baseUrl ?? "");
            } else {
              // A named provider has one endpoint. Accepting an override here would
              // turn "OpenRouter" into an arbitrary host with the allowed name.
              const requested = body?.baseUrl
                ? assertSafeBaseUrl(body.baseUrl)
                : PROVIDER_PRESETS[provider];
              if (requested !== PROVIDER_PRESETS[provider]) {
                throw new SecretError(
                  "BAD_BASE_URL",
                  "a named provider has a fixed endpoint; use the custom provider instead",
                );
              }
              baseUrl = PROVIDER_PRESETS[provider];
            }
            // Custom hosts are resolved once at save time for an immediate, clear
            // rejection; every request re-checks and pins the address in `safeFetch`.
            if (provider === "custom") await assertPublicDns(baseUrl);
          } catch (error) {
            fail(
              response,
              422,
              error?.code ?? "BAD_BASE_URL",
              error.message,
            );
            return true;
          }
          if (!isUserScope) {
            const policy = await store.getAiPolicy(orgId);
            if (policy.providers?.length && !policy.providers.includes(provider)) {
              fail(response, 422, "PROVIDER_NOT_ALLOWED", "this provider is not allowed here");
              return true;
            }
          }
          const kek = kekFromEnv();
          if (!kek) {
            fail(response, 503, "AI_CREDENTIALS_LOCKED", "set REMO_KEK on the server");
            return true;
          }
          const id = randomUUID();
          const encrypted = encryptSecret(secret, {
            scope,
            scopeId,
            provider,
            id,
            kek,
          });
          const row = await store.createAiCredential({
            id,
            scope,
            scopeId,
            provider,
            label: String(body?.label ?? "").trim().slice(0, 60),
            baseUrl,
            model: body?.model ? String(body.model).trim().slice(0, 120) : null,
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            dekWrapped: encrypted.dekWrapped,
            dekNonce: encrypted.dekNonce,
            kekId: encrypted.kekId,
            fingerprint: fingerprintSecret(secret),
            isDefault: body?.isDefault !== false,
            createdBy: me.id,
          });
          await audit({
            orgId: isUserScope ? null : orgId,
            action: "ai.credential.create",
            subject: `${scope}:${provider}`,
            after: { id: row.id, fingerprint: row.fingerprint, model: row.model },
          });
          json(response, 201, { credential: credentialView(row) });
          return true;
        }
      }

      const id = suffix[1];
      if (id && suffix[2] === "rotate" && method === "POST") {
        const row = await store.getAiCredential(id);
        if (!credentialScope(row, scope, scopeId)) {
          fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
          return true;
        }
        const body = await readBody(request);
        const secret = String(body?.secret ?? "");
        if (secret.length < 4 || secret.length > 2048) {
          fail(response, 422, "BAD_SECRET", "the key looks empty or too long");
          return true;
        }
        const kek = kekFromEnv();
        if (!kek) {
          fail(response, 503, "AI_CREDENTIALS_LOCKED", "set REMO_KEK on the server");
          return true;
        }
        const encrypted = encryptSecret(secret, {
          scope,
          scopeId,
          provider: row.provider,
          id: row.id,
          kek,
        });
        const rotated = await store.rotateAiCredential({
          id: row.id,
          scope,
          scopeId,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          dekWrapped: encrypted.dekWrapped,
          dekNonce: encrypted.dekNonce,
          kekId: encrypted.kekId,
          fingerprint: fingerprintSecret(secret),
        });
        await audit({
          orgId: isUserScope ? null : orgId,
          action: "ai.credential.rotate",
          subject: `${scope}:${row.provider}`,
          after: { id: row.id },
        });
        json(response, 200, { credential: credentialView({ ...row, ...rotated }) });
        return true;
      }

      if (id && suffix[2] === "default" && method === "POST") {
        const row = await store.getAiCredential(id);
        if (!credentialScope(row, scope, scopeId)) {
          fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
          return true;
        }
        await store.setDefaultAiCredential({
          id: row.id,
          scope,
          scopeId,
          provider: row.provider,
        });
        await audit({
          orgId: isUserScope ? null : orgId,
          action: "ai.credential.default",
          subject: `${scope}:${row.provider}`,
          after: { id: row.id },
        });
        json(response, 200, { ok: true });
        return true;
      }

      if (id && suffix[2] === "test" && method === "POST") {
        const row = await store.getAiCredential(id);
        if (!credentialScope(row, scope, scopeId)) {
          fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
          return true;
        }
        const kek = kekFromEnv();
        if (!kek) {
          fail(response, 503, "AI_CREDENTIALS_LOCKED", "set REMO_KEK on the server");
          return true;
        }
        try {
          const secret = decryptSecret(row, { kek });
          await probeProvider(row.base_url, secret);
          json(response, 200, { ok: true });
        } catch (error) {
          fail(response, 422, "KEY_REJECTED", error.message);
        }
        return true;
      }

      if (id && suffix.length === 2 && method === "DELETE") {
        const revoked = await store.revokeAiCredential(id, scope, scopeId);
        if (!revoked) {
          fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
          return true;
        }
        await audit({
          orgId: isUserScope ? null : orgId,
          action: "ai.credential.delete",
          subject: id,
        });
        json(response, 200, { ok: true });
        return true;
      }
    }
  }

  return false;
}
