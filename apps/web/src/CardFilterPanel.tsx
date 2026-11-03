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
      <label className="card-field">
        <span>{t("filter.assignee")}</span>
        <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
          <option value="">{t("filter.anyone")}</option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className="card-field">
        <span>{t("filter.due")}</span>
        <select
          value={due}
          onChange={(event) => setDue(event.target.value as CardFilter["due"])}
        >
          <option value="any">{t("filter.anyDue")}</option>
          <option value="overdue">{t("filter.overdue")}</option>
          <option value="none">{t("filter.noDue")}</option>
        </select>
      </label>
      <div className="kanban-actions">
        <button type="button" onClick={apply}>
          {t("filter.apply")}
        </button>
      </div>
      {found !== null && (
        <p className="muted">
          {found ? t("filter.found", { count: found }) : t("filter.empty")}
        </p>
      )}
    </div>
  );
}
