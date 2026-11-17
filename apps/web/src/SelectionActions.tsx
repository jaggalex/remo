import { useEffect, useRef, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import type { Widget } from "@remo/model";
import { Button, IconButton, Menu, Tooltip, type IconName, type MenuItem } from "@remo/ui";
import { commandById, type CommandContext } from "./commands";
import { isEditable } from "./BoardCanvas";
import { useI18n, type TranslationKey } from "./i18n";
import { useMenuFocus } from "./useMenuFocus";

/** The clipboard and grouping row: a command id and its icon, in reading order. */
const CLIPBOARD: ReadonlyArray<readonly [string, IconName]> = [
  ["copy", "copy"],
  ["copyLink", "link"],
  ["cut", "cut"],
  ["duplicate", "duplicate"],
];
const GROUPING: ReadonlyArray<readonly [string, IconName]> = [
  ["group", "group-make"],
  ["ungroup", "group-break"],
];
const LAYERS: ReadonlyArray<readonly [string, IconName]> = [
  ["front", "layer-top"],
  ["forward", "layer-up"],
  ["backward", "layer-down"],
  ["back", "layer-bottom"],
];

/**
 * Selection actions in the room overview, one frame per level (ADR-233, sketch D3).
 *
 * Icons without outlines in groups: clipboard · grouping · delete, then the actions whose
 * meaning no icon carries as words, the rare ones behind «⋯», and order and lock as their
 * own captioned group. Every button runs a command App already owns (ADR-093); this file
 * only arranges them.
 */
export function SelectionActions({
  commandContext,
  widgets,
  selectedIds,
  setSelectedIds,
  board,
  setWidgetPositions,
  canJoinSelection,
  connectSelection,
  setEditingId,
  selectionLocked,
  writeBlocked,
}: {
  commandContext: CommandContext;
  widgets: Widget[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  board: BoardDocument;
  setWidgetPositions: (board: BoardDocument, positions: { id: string; x: number; y: number }[]) => void;
  canJoinSelection: boolean;
  connectSelection: () => void;
  setEditingId: (id: string | null) => void;
  selectionLocked: boolean;
  writeBlocked: boolean;
}) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const anchor = useMenuFocus(moreOpen ? "more" : null, "more");
  const box = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen]);

  const commandButton = ([id, icon]: readonly [string, IconName], extra?: { selected?: boolean }) => {
    const command = commandById(id);
    if (!command) return null;
    const label = t(command.label(commandContext) as TranslationKey);
    return (
      <Tooltip key={id} label={label}>
        <IconButton
          icon={icon}
          size="compact"
          label={label}
          disabled={!command.enabled(commandContext)}
          selected={extra?.selected}
          onClick={() => command.run(commandContext)}
        />
      </Tooltip>
    );
  };

  const info = commandById("info");
  const more: MenuItem[] = [
    {
      label: t("inspector.nudge"),
      onSelect: () => {
        const positions = widgets
          .filter((w) => selectedIds.includes(w.id) && !w.parentId)
          .map((w) => ({ id: w.id, x: w.x + 40, y: w.y }));
        setWidgetPositions(board, positions);
      },
    },
    ...(info
      ? [
          {
            label: t(info.label(commandContext) as TranslationKey),
            hint: t("inspector.infoTitle"),
            icon: "info" as const,
            disabled: !info.enabled(commandContext),
            onSelect: () => info.run(commandContext),
          },
        ]
      : []),
    { label: t("inspector.clear"), onSelect: () => setSelectedIds([]) },
  ];
  const lock = commandById("lock");

  return (
    <div className={`selection-actions${writeBlocked ? " readonly" : ""}`}>
      <div className="selection-row" role="group" aria-label={t("inspector.actions")}>
        {CLIPBOARD.map((entry) => commandButton(entry))}
        <span className="selection-sep" aria-hidden="true" />
        {GROUPING.map((entry) => commandButton(entry))}
        <span className="selection-push">{commandButton(["delete", "trash"])}</span>
      </div>
      <div className="selection-row">
        <Button
          variant="ghost"
          size="compact"
          disabled={selectedIds.length !== 1 || !widgets.some((w) => w.id === selectedIds[0] && isEditable(w))}
          onClick={() => setEditingId(selectedIds[0] ?? null)}
          title={t("inspector.editTextTitle")}
        >
          {t("inspector.editText")}
        </Button>
        <Button
          variant="ghost"
          size="compact"
          disabled={!canJoinSelection}
          onClick={connectSelection}
          title={canJoinSelection ? t("inspector.connectTitle") : t("inspector.connectHint")}
        >
          {t("inspector.connect")}
        </Button>
        <span
          className="selection-more"
          onKeyDown={(event) => {
            // Escape closes this menu only: on the board it would also clear the selection,
            // and the panel the person was working in would vanish with it.
            if (event.key === "Escape" && moreOpen) event.stopPropagation();
          }}
          ref={(element) => {
            anchor.current = element;
            box.current = element;
          }}
        >
          <Tooltip label={t("inspector.moreActions")}>
            <IconButton
              icon="more"
              size="compact"
              label={t("inspector.moreActions")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            />
          </Tooltip>
          {moreOpen && (
            <Menu
              label={t("inspector.moreActions")}
              width={220}
              onClose={() => setMoreOpen(false)}
              items={more.map((item) =>
                "onSelect" in item && item.onSelect
                  ? {
                      ...item,
                      onSelect: () => {
                        item.onSelect?.();
                        setMoreOpen(false);
                      },
                    }
                  : item,
              )}
            />
          )}
        </span>
      </div>
      <div className="selection-group">
        <h3>{t("inspector.layer")}</h3>
        <div className="selection-row" role="group" aria-label={t("inspector.layer")}>
          {LAYERS.map((entry) => commandButton(entry))}
          {lock && (
            <span className="selection-push">
              {commandButton([lock.id, selectionLocked ? "lock" : "unlock"], { selected: selectionLocked })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
