import { useState } from "react";
import { Button, Textarea } from "@remo/ui";
import { MAX_ALT } from "@remo/doc";
import { useI18n } from "../i18n";
import { PanelWindow } from "./PanelWindow";

/**
 * The description of a picture (`spec/images.md` §9.5).
 *
 * A small window beside the bar, not a modal: the person writes one or two sentences while
 * still seeing the picture, which a dialog would cover. It commits as one document edit on
 * Save or ⌘Enter, and Escape restores what was there — the same rule as the object name.
 */
export function ImageAltWindow({
  alt,
  onSave,
  onClose,
}: {
  alt: string;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(alt);

  const commit = () => {
    onSave(value);
    onClose();
  };

  return (
    <PanelWindow>
      <div
        className="image-alt-window"
        role="dialog"
        aria-label={t("image.alt.title")}
        // The bar swallows pointerdown to keep the caret in a note; a text field inside it
        // needs the event, or clicking into the description would not place the caret.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Textarea
          label={t("image.alt.title")}
          hint={t("image.alt.hint")}
          placeholder={t("image.alt.placeholder")}
          value={value}
          rows={3}
          autoFocus
          maxLength={MAX_ALT}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit();
            }
          }}
        />
        <div className="image-alt-foot">
          <span className="muted">
            {t("image.alt.count", { count: value.length, max: MAX_ALT })}
          </span>
          <Button size="compact" variant="primary" onClick={commit}>
            {t("image.alt.save")}
          </Button>
        </div>
      </div>
    </PanelWindow>
  );
}
