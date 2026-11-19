import { ApiError } from "./api";
import { taskFileErrorText } from "./agentFile";
import type { TranslationKey } from "./i18n";

/**
 * Turn an agent-dialog failure into a sentence a person can act on.
 *
 * "Failed to fetch" is a browser phrase, not a diagnosis: it usually means the sync
 * service is down. A missing board or a role refusal get their own instructions instead
 * of a generic error.
 */
export function agentFailureText(
  failure: unknown,
  t: (key: TranslationKey) => string,
): string {
  if (failure instanceof ApiError) {
    // The file door repeats the server codes: a 422 must read like the field error,
    // not like an English sentence from the service.
    if (
      failure.code.startsWith("BAD_FILE") ||
      failure.code === "FILE_TOO_LARGE" ||
      failure.code === "BAD_CSV" ||
      failure.code === "BAD_TEXT"
    ) {
      return taskFileErrorText(failure.code, t);
    }
    if (failure.code === "AI_NOT_CONFIGURED") return t("agents.aiNotConfigured");
    if (failure.code === "AI_CREDENTIALS_LOCKED") return t("agents.kekMissing");
    if (
      failure.code === "AI_MODEL_REQUIRED" ||
      failure.code === "AI_CREDENTIALS_LOCKED" ||
      failure.code === "AI_CREDENTIAL_MISSING" ||
      failure.code === "AI_CREDENTIAL_FORBIDDEN" ||
      failure.code === "AI_CREDENTIAL_UNREADABLE"
    ) {
      return t("agents.aiCredentialProblem");
    }
    if (failure.code === "SKILL_UNAVAILABLE") return t("agents.skillUnavailable");
    if (failure.code === "SKILL_NOT_SUPPORTED") return t("agents.skillUnsupported");
    if (failure.status === 401) return t("agents.authRequired");
    if (failure.status === 403) return t("agents.noAccess");
    if (failure.status === 404) return t("agents.boardUnavailable");
    return failure.message || t("agents.failed");
  }
  if (
    failure instanceof TypeError ||
    (failure instanceof Error && /Failed to fetch|NetworkError/i.test(failure.message))
  ) {
    return t("agents.unreachable");
  }
  return t("agents.failed");
}
