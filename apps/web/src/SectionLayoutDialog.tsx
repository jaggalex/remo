import { useEffect, useRef } from "react";
import { applySectionTablePlan, type BoardDocument, type SectionTablePlan } from "@remo/doc";
import type { Widget } from "@remo/model";
import { Button } from "@remo/ui";
import { useI18n } from "./i18n";
import {
  setSectionLayoutMode,
  type SectionLayoutRequest,
} from "./sectionLayoutStore";

/**
 * "How to lay out the material?" (ADR-207, T4).
 *
 * The card is not modal: the canvas preview stays visible behind it. Apply writes the
 * same plan the preview drew, as one command and one undo.
 */
export function SectionLayoutDialog({
  board,
  frame,
  plan,
  request,
  camera,
  viewport,
  onClose,
}: {
  board: BoardDocument;
  frame: Widget;
  plan: SectionTablePlan;
  request: SectionLayoutRequest;
  camera: { x: number; y: number; zoom: number };
  viewport: { width: number; height: number };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const card = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    card.current?.focus();
  }, [request.frameId]);

  const left = Math.min(
    Math.max(
      24,
      (frame.x + frame.width / 2 - camera.x) * camera.zoom + viewport.width / 2 + 24,
    ),
    Math.max(24, viewport.width - 344),
  );
  const top = Math.min(
    Math.max(
      24,
      (frame.y - frame.height / 2 - camera.y) * camera.zoom + viewport.height / 2,
    ),
    Math.max(24, viewport.height - 260),
  );

  return (
    <div
      ref={card}
      className="section-layout-card"
      role="dialog"
      aria-label={t("section.layout.title")}
      tabIndex={-1}
      style={{ left, top }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <h2>{t("section.layout.title")}</h2>
      <label className="section-layout-option">
        <input
          type="radio"
          name="section-layout-mode"
          checked={request.mode === "position"}
          onChange={() => setSectionLayoutMode("position")}
        />
        <span>{t("section.layout.byPosition")}</span>
      </label>
      <label className="section-layout-option">
        <input
          type="radio"
          name="section-layout-mode"
          checked={request.mode === "first"}
          onChange={() => setSectionLayoutMode("first")}
        />
        <span>{t("section.layout.firstCell")}</span>
      </label>
      <p className="muted">{t("section.layout.preview")}</p>
      <p className="muted">{t("section.layout.hint")}</p>
      <div className="section-layout-actions">
        <Button size="compact" variant="secondary" onClick={onClose}>
          {t("section.layout.cancel")}
        </Button>
        <Button
          size="compact"
          onClick={() => {
            applySectionTablePlan(board, frame.id, plan);
            onClose();
          }}
        >
          {t("section.layout.apply")}
        </Button>
      </div>
    </div>
  );
}
