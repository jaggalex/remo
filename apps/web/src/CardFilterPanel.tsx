import { Button, Select } from "@remo/ui";
import { useMemo, useState } from "react";
import type { Widget } from "@remo/model";
import { cardAssignees, cardsMatching, type CardFilter } from "./cardFilter";
import { useI18n } from "./i18n";

/**
 * Card filters as a selection (ADR-112).
 *
 * The canvas is never filtered: the panel picks the matching cards, and the ordinary
 * commands act on the selection. No saved views, no document write.
 */
export function CardFilterPanel({
  widgets,
  setSelectedIds,
}: {
  widgets: Widget[];
  setSelectedIds: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState<CardFilter["due"]>("any");
  const [found, setFound] = useState<number | null>(null);
  const assignees = useMemo(() => cardAssignees(widgets), [widgets]);

  const apply = () => {
    const matches = cardsMatching(widgets, { assigneeId, due });
    setFound(matches.length);
    setSelectedIds(matches.map((widget) => widget.id));
  };

  return (
    <div className="card-filter">
      <div className="card-fields-head">{t("filter.title")}</div>
      <Select
        label={t("filter.assignee")}
        size="compact"
        options={[
          { value: "", label: t("filter.anyone") },
          ...assignees.map((person) => ({ value: person.id, label: person.name })),
        ]}
        value={assigneeId}
        onChange={(event) => setAssigneeId(event.target.value)}
      />
      <Select
        label={t("filter.due")}
        size="compact"
        options={[
          { value: "any", label: t("filter.anyDue") },
          { value: "overdue", label: t("filter.overdue") },
          { value: "none", label: t("filter.noDue") },
        ]}
        value={due}
        onChange={(event) => setDue(event.target.value as CardFilter["due"])}
      />
      <div className="kanban-actions">
        <Button size="compact" onClick={apply}>
          {t("filter.apply")}
        </Button>
      </div>
      {found !== null && (
        <p className="muted">
          {found ? t("filter.found", { count: found }) : t("filter.empty")}
        </p>
      )}
    </div>
  );
}
