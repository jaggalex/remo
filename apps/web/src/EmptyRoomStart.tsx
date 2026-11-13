import { Button } from "@remo/ui";
import { useI18n } from "./i18n";
import { useProposal } from "./proposalStore";

/**
 * The empty room's first line: a note or a shape, two equal actions (ADR-197).
 *
 * The old card sent a newcomer to the More menu for a template. Here the first object
 * is one click away; a template is a quiet example, not the entrance. A plan under review
 * owns the empty canvas, so the card steps aside.
 */
export function EmptyRoomStart({
  readOnly,
  onCreateNote,
  onCreateShape,
  onCreateText,
  onExample,
}: {
  readOnly: boolean;
  onCreateNote: () => void;
  onCreateShape: () => void;
  onCreateText: () => void;
  onExample: () => void;
}) {
  const { t } = useI18n();
  if (useProposal()) return null;
  return (
    <div className="empty-board">
      <b>{t("empty.title")}</b>
      <span>{t("empty.body")}</span>
      {!readOnly && (
        <div className="empty-actions">
          <Button variant="secondary" icon="sticky" onClick={() => onCreateNote()}>
            {t("empty.note")}
          </Button>
          <Button variant="secondary" icon="shape" onClick={() => onCreateShape()}>
            {t("empty.shape")}
          </Button>
          <Button variant="ghost" onClick={() => onCreateText()}>
            {t("empty.text")}
          </Button>
          <Button variant="ghost" onClick={() => onExample()}>
            {t("empty.example")}
          </Button>
        </div>
      )}
    </div>
  );
}
