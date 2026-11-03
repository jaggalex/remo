import { useId, useMemo, useState } from "react";
import type { PlannedObject } from "@remo/doc";
import { Button } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * Every object, grouped by kind (ADR-142, M3).
 *
 * A preview that names only the first twenty hides the reason a plan is large. The
 * groups carry their own count and the collapsed state renders a few rows per kind;
 * a 300-object plan costs about twenty DOM rows until a person asks for all of them.
 */

const PREVIEW_PER_GROUP = 5;
const GROUP_ORDER = ["frame", "sticky_note", "text", "shape"];

interface Group {
  type: string;
  items: PlannedObject[];
}

function groupObjects(objects: PlannedObject[]): Group[] {
  const groups = new Map<string, Group>();
  for (const object of objects) {
    const group = groups.get(object.type) ?? { type: object.type, items: [] };
    group.items.push(object);
    groups.set(object.type, group);
  }
  return [...groups.values()].sort((first, second) => {
    const rank = (type: string) => {
      const index = GROUP_ORDER.indexOf(type);
      return index === -1 ? GROUP_ORDER.length : index;
    };
    return rank(first.type) - rank(second.type) || first.type.localeCompare(second.type);
  });
}

export function AgentPlanObjects({ objects }: { objects: PlannedObject[] }) {
  const { t, typeCount } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const groups = useMemo(() => groupObjects(objects), [objects]);
  const previewRows = groups.reduce(
    (total, group) => total + Math.min(group.items.length, PREVIEW_PER_GROUP),
    0,
  );
  const canExpand = previewRows < objects.length;

  if (!objects.length) {
    return <p className="muted">{t("agents.plan.objectsEmpty")}</p>;
  }

  return (
    <section className="agent-plan-section" aria-label={t("agents.plan.objects", { total: objects.length })}>
      <div className="agent-plan-objects-head">
        <strong>{t("agents.plan.objects", { total: objects.length })}</strong>
        {canExpand && (
          <Button
            variant="secondary"
            size="compact"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("agents.plan.objectsLess")
              : t("agents.plan.objectsAll", { total: objects.length })}
          </Button>
        )}
      </div>

      <div className="agent-plan-object-list" id={listId}>
        {groups.map((group) => {
          const shown = expanded ? group.items : group.items.slice(0, PREVIEW_PER_GROUP);
          return (
            <section className="agent-plan-object-group" key={group.type}>
              <h3 className="agent-plan-object-group-head">
                {typeCount(group.type, group.items.length)}
              </h3>
              <ul className="agent-plan-objects">
                {shown.map((object) => {
                  const label = object.title ?? object.text ?? "";
                  return (
                    <li key={object.tempId}>
                      <span className="muted agent-plan-object-at">
                        {Math.round(object.x)}, {Math.round(object.y)}
                      </span>
                      {object.shapeKind && (
                        <span className="agent-plan-object-kind">{object.shapeKind}</span>
                      )}
                      {label && <span className="agent-plan-object-text">{label}</span>}
                    </li>
                  );
                })}
              </ul>
              {!expanded && group.items.length > PREVIEW_PER_GROUP && (
                <p className="muted agent-plan-object-more">
                  {t("agents.plan.objectsMore", {
                    shown: PREVIEW_PER_GROUP,
                    total: group.items.length,
                  })}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
