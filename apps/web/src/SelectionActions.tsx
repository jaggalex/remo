import { useEffect, useRef, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import type { Widget } from "@remo/model";
import { IconButton, Menu, Tooltip, type IconName, type MenuItem } from "@remo/ui";
import { commandById, type CommandContext } from "./commands";
import { isEditable } from "./BoardCanvas";
import { useI18n, type TranslationKey } from "./i18n";
import { elevationMenuItems } from "./elevationMenu";
import { useMenuFocus } from "./useMenuFocus";

/** The clipboard part of the row: a command id and its icon, in reading order. */
const CLIPBOARD: ReadonlyArray<readonly [string, IconName]> = [
  ["copy", "copy"],
  ["copyLink", "link"],
  ["cut", "cut"],
  ["duplicate", "duplicate"],
];
/** Layer commands that live in «⋯»; "forward" keeps its slot in the row. */
const MORE_LAYERS = ["front", "backward", "back"] as const;

/**
 * Selection actions: one row of icons without outlines (ADR-237, sketch D4).
 *
 * Clipboard · one grouping slot · bring forward and lock · delete and «⋯». Everything
 * else, including the actions no icon names well, is in «⋯». Every button runs a command
 * App already owns (ADR-093); this file only arranges them.
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

  const run = (id: string) => {
    const command = commandById(id);
    return command
      ? {
          label: t(command.label(commandContext) as TranslationKey),
          disabled: !command.enabled(commandContext),
          onSelect: () => command.run(commandContext),
        }
      : null;
  };
  const editable =
    selectedIds.length === 1 && widgets.some((w) => w.id === selectedIds[0] && isEditable(w));
  const info = run("info");
  const more: MenuItem[] = [
    {
      label: t("inspector.editText"),
      hint: t("inspector.editTextTitle"),
      disabled: !editable,
      onSelect: () => setEditingId(selectedIds[0] ?? null),
    },
    {
      label: t("inspector.connect"),
      hint: canJoinSelection ? t("inspector.connectTitle") : t("inspector.connectHint"),
      disabled: !canJoinSelection,
      onSelect: connectSelection,
    },
    { separator: true },
    ...MORE_LAYERS.map(run).filter((item): item is NonNullable<typeof item> => item !== null),
    ...elevationMenuItems(board, widgets, selectedIds, writeBlocked, t),
    { separator: true },
    {
      label: t("inspector.nudge"),
      onSelect: () => {
        const positions = widgets
          .filter((w) => selectedIds.includes(w.id) && !w.parentId)
          .map((w) => ({ id: w.id, x: w.x + 40, y: w.y }));
        setWidgetPositions(board, positions);
      },
    },
    ...(info ? [{ ...info, hint: t("inspector.infoTitle"), icon: "info" as const }] : []),
    { label: t("inspector.clear"), onSelect: () => setSelectedIds([]) },
  ];
  const ungroup = commandById("ungroup");
  const grouping: readonly [string, IconName] =
    ungroup?.enabled(commandContext) ? ["ungroup", "group-break"] : ["group", "group-make"];
  const lock = commandById("lock");

  return (
    <div className={`selection-actions${writeBlocked ? " readonly" : ""}`}>
      <div className="selection-row" role="group" aria-label={t("inspector.actions")}>
        {CLIPBOARD.map((entry) => commandButton(entry))}
        <span className="selection-sep" aria-hidden="true" />
        {commandButton(grouping)}
        {commandButton(["forward", "layer-up"])}
        {lock && commandButton([lock.id, selectionLocked ? "lock" : "unlock"], { selected: selectionLocked })}
        <span className="selection-push">{commandButton(["delete", "trash"])}</span>
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
    </div>
  );
}
