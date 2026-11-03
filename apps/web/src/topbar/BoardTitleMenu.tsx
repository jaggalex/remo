import { useEffect, useRef } from "react";
import { Button, Menu, type MenuItem } from "@remo/ui";
import { useI18n, type TranslationKey } from "../i18n";
import { useMenuFocus } from "../useMenuFocus";

/**
 * The board's name, and everything that acts on the board as a document (ADR-119).
 *
 * The title is a button with a menu, not a text field: renaming is one item among
 * settings, export, restore, a copy and the trash. The field appears in place only while
 * renaming, so the name still reads as a name the rest of the time
 * (ADR-119, Ш1).
 */
export function BoardTitleMenu({
  title,
  renaming,
  onRenaming,
  draft,
  onDraft,
  onCommit,
  onCancel,
  open,
  onOpen,
  items,
  readOnly,
}: {
  title: string;
  renaming: boolean;
  onRenaming: (value: boolean) => void;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  open: boolean;
  onOpen: (value: boolean) => void;
  items: MenuItem[];
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const anchor = useMenuFocus(open, true);
  const shown = title || t("board.untitled");
  const input = useRef<HTMLInputElement | null>(null);

  // Ready to type, with the current name selected, the way renaming works everywhere.
  useEffect(() => {
    if (!renaming) return;
    input.current?.focus();
    input.current?.select();
  }, [renaming]);

  if (renaming && !readOnly) {
    return (
      <input
        ref={input}
        className="board-title"
        value={draft}
        maxLength={120}
        aria-label={t("board.name")}
        onChange={(event) => onDraft(event.target.value)}
        onBlur={(event) => onCommit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
    );
  }

  return (
    <span className="topbar-anchor topbar-anchor-start" ref={anchor}>
      <Button
        variant="ghost"
        iconEnd="chevron-down"
        className="board-title-button"
        aria-label={`${t("board.menu")}: ${shown}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        {shown}
      </Button>
      {open && (
        <Menu
          label={t("board.menu")}
          width={248}
          onClose={() => onOpen(false)}
          items={items}
        />
      )}
    </span>
  );
}

/** The items of the board menu, in the order the mockup fixes (Home-Menus). */
export function boardMenuItems({
  canDuplicate,
  canDelete,
  canExport,
  canBackup,
  canImport,
  writeBlocked,
  t,
  onRename,
  onSettings,
  onExport,
  onRestore,
  onDuplicate,
  onTrash,
}: {
  canDuplicate: boolean;
  canDelete: boolean;
  canExport: boolean;
  canBackup: boolean;
  canImport: boolean;
  writeBlocked: boolean;
  t: (key: TranslationKey) => string;
  onRename: () => void;
  onSettings: () => void;
  onExport: () => void;
  onRestore: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: t("board.rename"),
      disabled: writeBlocked,
      onSelect: onRename,
    },
    // Settings are a personal, browser-local preference (ADR-123): never blocked.
    { label: t("board.boardSettings"), onSelect: onSettings },
  ];
  if (canExport || canBackup || canImport) items.push({ separator: true });
  if (canExport || canBackup) items.push({ label: t("board.exportAction"), onSelect: onExport });
  if (canImport) items.push({ label: t("board.restoreAction"), onSelect: onRestore });
  if (canDuplicate) items.push({ label: t("board.duplicateAction"), onSelect: onDuplicate });
  if (canDelete) {
    items.push({ separator: true }, { label: t("board.trashAction"), danger: true, onSelect: onTrash });
  }
  return items;
}
