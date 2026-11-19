import type { ReactNode } from "react";
import { Icon } from "@remo/ui";
import { useI18n } from "../i18n";
import type { HelpTopicId } from "./topics.generated";

/**
 * A stable link from a product screen to one help topic (ADR-081).
 *
 * The URL contains the language so a shared link opens the same language; the topic id
 * is checked by tsc against the generated list. Without children it is an icon button
 * with a name, not a "?" glyph that looks like a link (ADR-119, Ш4/Ш6).
 */
export function HelpLink({
  topicId,
  className,
  label,
  children,
}: {
  topicId: HelpTopicId;
  className?: string;
  label?: string;
  children?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const name = label ?? t("help.open");
  return (
    <a
      className={className ?? "help-link"}
      href={`/help/${lang}/${topicId}`}
      aria-label={name}
      title={name}
    >
      {children ?? <Icon name="help" size={16} />}
    </a>
  );
}
