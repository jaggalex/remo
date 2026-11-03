import type { TranslationKey } from "./i18n";

/**
 * One sentence for "what my role is, and where it comes from" (ADR-069).
 *
 * The account menu and the sharing dialog answer the same question, so they read the
 * same sentence from one place instead of two copies that drift apart.
 */
export function roleSourceLine(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  role: string | null,
  sources: readonly string[],
): string | null {
  if (!role) return null;
  const roleName = t(`role.${role}` as TranslationKey);
  if (sources.length === 1 && sources[0] === "owner") {
    return t("share.roleOnly", { role: roleName });
  }
  const names = [...new Set(sources)].map((source) =>
    source === "owner"
      ? t("share.sourceOwner")
      : source === "grant:team"
        ? t("share.sourceTeamShort")
        : source === "grant:org"
          ? t("share.sourceOrgShort")
          : source === "link"
            ? t("share.sourceLink")
            : t("share.sourceDirect"),
  );
  return t("share.effective", { role: roleName, sources: names.join(", ") });
}
