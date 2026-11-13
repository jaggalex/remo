import type { Tag, Widget } from "@remo/model";
import { scalesInBlock } from "@remo/model";
import { useI18n } from "./i18n";

/**
 * What is selected, and how big it is.
 *
 * A line reports the size it is drawn at, not the box it was created with: moving an
 * endpoint changes the path without rewriting the stored box, and the badge used to
 * report a shape that no longer existed.
 */
export function SelectionBadge({
  selectedIds,
  selectedWidget,
  selectedGroup,
  selectedGroupName,
  selectedTags,
  selectedLineSize,
  selectedWidgets = [],
  resizeLimit,
}: {
  selectedIds: readonly string[];
  selectedWidget: Widget | undefined;
  /** A group id when the selection is exactly one group and nothing else. */
  selectedGroup: string | null;
  /** Its label, when it has one (ADR-101). */
  selectedGroupName?: string;
  selectedTags?: Tag[];
  selectedLineSize: { width: number; height: number } | null;
  /** Every selected object, so a block can name its composition (ADR-211). */
  selectedWidgets?: readonly Widget[];
  /** While a block is stopped at a minimum, the size the person is pressing against. */
  resizeLimit?: { width: number; height: number } | null;
}) {
  const { t, count, typeName } = useI18n();
  if (!selectedIds.length) return null;
  return (
    <div className="selection-badge">
      {selectedIds.length === 1 && selectedWidget ? (
        <>
          <strong>{typeName(selectedWidget.type)}</strong>
          <span>
            {(selectedLineSize?.width ?? Math.round(selectedWidget.width))} ×{" "}
            {(selectedLineSize?.height ?? Math.round(selectedWidget.height))}
          </span>
          {selectedWidget.locked && (
            <span
              className="badge-lock"
              title={
                selectedWidget.lockedByName
                  ? t("canvas.lockedBy", { name: selectedWidget.lockedByName })
                  : t("canvas.locked")
              }
            >
              🔒
            </span>
          )}
          {(selectedWidget.title ?? selectedWidget.content) && (
            <span className="muted">
              {(selectedWidget.title ?? selectedWidget.content ?? "").slice(0, 48)}
            </span>
          )}
          {selectedTags?.map((tag) => (
            <span key={tag.id} className={`tag-chip tag-${tag.color}`}>
              {tag.name}
            </span>
          ))}
        </>
      ) : selectedGroup ? (
        <>
          <strong>{selectedGroupName || t("canvas.group")}</strong>
          <span className="muted">{count("objects", selectedIds.length)}</span>
        </>
      ) : (
        <>
          <strong>{count("objects", selectedIds.length)}</strong>
          {(() => {
            const scalable = selectedWidgets.filter(scalesInBlock).length;
            const pinned = selectedWidgets.filter((widget) => widget.locked).length;
            return (
              <>
                {scalable > 0 && (
                  <span className="muted"> · {count("scalable", scalable)}</span>
                )}
                {pinned > 0 && <span className="muted"> · {count("pinned", pinned)}</span>}
                {scalable === 0 && (
                  <span className="muted"> · {t("canvas.resize.moveOnly")}</span>
                )}
                {resizeLimit && (
                  <span className="muted">
                    {" "}
                    · {t("canvas.resize.limit", {
                      size: `${Math.round(resizeLimit.width)} × ${Math.round(resizeLimit.height)}`,
                    })}
                  </span>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
