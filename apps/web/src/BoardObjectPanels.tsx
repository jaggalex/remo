import { useEffect, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import {
  TAG_COLORS,
  type CardFields,
  type CardStatus,
  type Tag,
  type TagColor,
  type Widget,
} from "@remo/model";
import {
  createTag,
  deleteTag,
  renameTag,
  safeExternalUrl,
  setCardFields,
  setGroupName,
  setTagColor,
  setWidgetLink,
  setWidgetName,
  setWidgetTags,
  toggleWidgetTag,
  widgetsWithTag,
} from "@remo/doc";
import { currentRoom } from "./identity";
import { Button, Checkbox, ConfirmDialog as UiConfirmDialog, Input, Select } from "@remo/ui";
import { useI18n, type TranslationKey } from "./i18n";

const TAG_COLOR_KEY: Record<TagColor, TranslationKey> = {
  blue: "tag.color.blue",
  green: "tag.color.green",
  yellow: "tag.color.yellow",
  red: "tag.color.red",
  gray: "tag.color.gray",
};

/**
 * The interface name of one object (ADR-165).
 *
 * The name is committed on blur or Enter, so typing is one undo step. The stable id is in
 * «⋯ → Инфо» with its copy button (ADR-236): a link, a command or a bug report needs it,
 * but it is not something a person edits.
 */
export function ObjectNameField({
  board,
  widget,
  disabled,
}: {
  board: BoardDocument;
  widget: Widget;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(widget.name ?? "");

  useEffect(() => {
    setValue(widget.name ?? "");
  }, [widget.id, widget.name]);

  const commit = () => {
    if (value.trim() === (widget.name ?? "")) return;
    setWidgetName(board, widget.id, value);
  };

  return (
    <div className="object-name-field">
      <Input
        label={t("inspector.objectName")}
        hint={t("inspector.objectNameHint")}
        placeholder={t("inspector.objectNamePlaceholder")}
        value={value}
        maxLength={120}
        disabled={disabled}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setValue(widget.name ?? "");
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/**
 * The name of one group.
 *
 * Local state commits on blur or Enter: typing a label is one undo step, not one per
 * keystroke, and the input does not fight a rename coming from another client.
 */
export function GroupNameField({
  board,
  groupId,
  name,
  disabled,
}: {
  board: BoardDocument;
  groupId: string;
  name: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(name);

  useEffect(() => setValue(name), [name]);

  const commit = () => {
    if (value.trim() === name) return;
    setGroupName(board, groupId, value);
  };

  return (
    <Input
      label={t("inspector.groupName")}
      size="compact"
        value={value}
        disabled={disabled}
        maxLength={64}
        placeholder={t("inspector.groupNamePlaceholder")}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setValue(name);
            event.currentTarget.blur();
          }
        }}
    />
  );
}

/**
 * The card's own record: status, assignee, range and (in M2) tags.
 *
 * The inspector is the only place these are edited; the card face is a read-out. One
 * setter per field keeps undo one action per change.
 */
export function CardFieldsPanel({
  board,
  card,
  people,
  disabled,
}: {
  board: BoardDocument;
  card: Widget;
  people: Array<{ id: string; name: string }>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: CardFields) => setCardFields(board, card.id, patch);
  const assignees =
    card.assigneeId && !people.some((person) => person.id === card.assigneeId)
      ? [...people, { id: card.assigneeId, name: card.assigneeName ?? card.assigneeId }]
      : people;

  return (
    <div className="card-fields">
      <div className="card-fields-head">
        {t("inspector.card")}
      </div>
      <Select
        label={t("card.status")}
        size="compact"
        options={[
          { value: "", label: "—" },
          { value: "todo", label: t("card.status.todo") },
          { value: "in_progress", label: t("card.status.in_progress") },
          { value: "done", label: t("card.status.done") },
        ]}
        value={card.status ?? ""}
        disabled={disabled}
        onChange={(event) =>
          set({ status: (event.target.value || undefined) as CardStatus | undefined })
        }
      />
      <Select
        label={t("card.assignee")}
        size="compact"
        options={[
          { value: "", label: t("card.unassigned") },
          ...assignees.map((person) => ({ value: person.id, label: person.name })),
        ]}
        value={card.assigneeId ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const person = assignees.find((entry) => entry.id === event.target.value);
          set({
            assigneeId: event.target.value || undefined,
            assigneeName: person?.name,
          });
        }}
      />
      <div className="card-dates">
        <Input
          label={t("card.start")}
          size="compact"
            type="date"
            value={card.startAt ?? ""}
            disabled={disabled}
            onChange={(event) => set({ startAt: event.target.value || undefined })}
        />
        <Input
          label={t("card.due")}
          size="compact"
            type="date"
            value={card.dueAt ?? ""}
            disabled={disabled}
            onChange={(event) => set({ dueAt: event.target.value || undefined })}
        />
      </div>
    </div>
  );
}

/**
 * Links on one object (ADR-103).
 *
 * One field with two targets: an external URL or another widget on the same board. The
 * internal target is the same deep link the search and the copy action use.
 */
export function ObjectLinkPanel({
  board,
  widget,
  widgets,
  disabled,
  onOpenObject,
}: {
  board: BoardDocument;
  widget: Widget;
  widgets: Widget[];
  disabled: boolean;
  onOpenObject: (boardId: string, widgetId: string) => void;
}) {
  const { t } = useI18n();
  const link = widget.link;
  const [url, setUrl] = useState(link?.kind === "url" ? link.url : "");
  const [target, setTarget] = useState(link?.kind === "widget" ? link.widgetId : "");
  const [error, setError] = useState("");
  const locked = disabled || Boolean(widget.locked);

  const applyUrl = () => {
    const safe = safeExternalUrl(url);
    if (!safe) {
      setError(t("link.invalid"));
      return;
    }
    setError("");
    setWidgetLink(board, widget.id, { kind: "url", url: safe });
  };

  const applyTarget = () => {
    setError("");
    if (!target || !setWidgetLink(board, widget.id, { kind: "widget", widgetId: target })) {
      setError(t("link.broken"));
    }
  };

  return (
    <div className="link-panel">
      <div className="link-row">
        <Input
          type="url"
          size="compact"
          label={t("link.external")}
          value={url}
          placeholder="https://…"
          disabled={locked}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button size="compact" disabled={locked || !url.trim()} onClick={applyUrl}>
          {t("link.apply")}
        </Button>
      </div>
      <div className="link-row">
        <Select
          size="compact"
          label={t("link.internal")}
          options={[
            { value: "", label: "—" },
            ...widgets
              .filter((candidate) => candidate.id !== widget.id)
              .slice(0, 200)
              .map((candidate) => ({
                value: candidate.id,
                label: candidate.title || candidate.content || candidate.id,
              })),
          ]}
          value={target}
          disabled={locked}
          onChange={(event) => setTarget(event.target.value)}
        />
        <Button size="compact" disabled={locked || !target} onClick={applyTarget}>
          {t("link.apply")}
        </Button>
      </div>
      {error && <p className="auth-error">{error}</p>}
      {link && (
        <div className="link-current">
          {link.kind === "url" ? (
            <Button variant="ghost" size="compact" onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}>
              {t("link.open")}: {link.url}
            </Button>
          ) : widgets.some((candidate) => candidate.id === link.widgetId) ? (
            <Button variant="ghost" size="compact" onClick={() => onOpenObject(currentRoom(), link.widgetId)}>
              {t("link.open")}: {t("link.internal")}
            </Button>
          ) : (
            <span className="muted">{t("link.broken")}</span>
          )}
          <Button variant="ghost" size="compact"
            disabled={locked}
            onClick={() => {
              setWidgetLink(board, widget.id, null);
              setUrl("");
              setTarget("");
            }}>
            {t("link.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The board tag vocabulary and the tags of the selected object (ADR-102).
 *
 * A filter is a selection: "show objects with this tag" selects them and reports the
 * count. Nothing is hidden silently, which is the behaviour the acceptance criterion
 * asks for.
 */
export function TagsPanel({
  board,
  widgets,
  selectedIds,
  setSelectedIds,
  disabled,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const tags = Object.values(board.tags.toJSON() as Record<string, Tag>).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const selected =
    selectedIds.length === 1 ? widgets.find((widget) => widget.id === selectedIds[0]) : undefined;
  const assignable =
    selected && (selected.type === "card" || selected.type === "sticky_note");

  return (
    <div className="tags-panel">
      <div className="tag-add">
        <Input
          size="compact"
          aria-label={t("tags.namePlaceholder")}
          value={name}
          maxLength={32}
          placeholder={t("tags.namePlaceholder")}
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            createTag(board, name, color);
            setName("");
          }}
        />
        <Select
          size="compact"
          aria-label={t("tags.color")}
          options={[
            ...TAG_COLORS.map((entry) => ({ value: entry, label: t(TAG_COLOR_KEY[entry]) })),
          ]}
          value={color}
          disabled={disabled}
          onChange={(event) => setColor(event.target.value as TagColor)}
        />
        <Button
          size="compact"
          disabled={disabled || !name.trim()}
          onClick={() => {
            createTag(board, name, color);
            setName("");
          }}
        >
          {t("tags.add")}
        </Button>
      </div>
      {tags.length === 0 && <p className="muted">{t("tags.empty")}</p>}
      <ul className="tag-list">
        {tags.map((tag) => (
          <TagRow
            key={tag.id}
            board={board}
            tag={tag}
            count={widgetsWithTag(board, tag.id).length}
            disabled={disabled}
            onFocus={() => setSelectedIds(widgetsWithTag(board, tag.id))}
          />
        ))}
      </ul>
      {assignable && (
        <div className="tag-assign">
          <div className="muted">{t("tags.onObject")}</div>
          {tags.map((tag) => (
            <Checkbox
              key={tag.id}
              className="tag-check"
              label={<span className={`tag-chip tag-${tag.color}`}>{tag.name}</span>}
              checked={Boolean(selected.tagIds?.includes(tag.id))}
              disabled={disabled || Boolean(selected.locked)}
              onChange={() => toggleWidgetTag(board, selected.id, tag.id)}
            />
          ))}
          {tags.length === 0 && <p className="muted">{t("tags.empty")}</p>}
        </div>
      )}
      {selected && tags.length > 0 && (
        <Button variant="ghost" size="compact"
          disabled={disabled || Boolean(selected.locked)}
          onClick={() => setWidgetTags(board, selected.id, [])}>
          {t("tags.clearObject")}
        </Button>
      )}
    </div>
  );
}

function TagRow({
  board,
  tag,
  count,
  disabled,
  onFocus,
}: {
  board: BoardDocument;
  tag: Tag;
  count: number;
  disabled: boolean;
  onFocus: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setName(tag.name), [tag.name]);

  return (
    <li className="tag-row">
      <span className={`tag-chip tag-${tag.color}`}>{tag.name}</span>
      <Input
        size="compact"
        className="tag-name-input"
        value={name}
        maxLength={32}
        disabled={disabled}
        aria-label={t("tags.rename")}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() === tag.name) setName(tag.name);
          else if (!renameTag(board, tag.id, name)) setName(tag.name);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setName(tag.name);
            event.currentTarget.blur();
          }
        }}
      />
      <Select
        size="compact"
        options={[
          ...TAG_COLORS.map((entry) => ({ value: entry, label: t(TAG_COLOR_KEY[entry]) })),
        ]}
        value={tag.color}
        disabled={disabled}
        aria-label={t("tags.color")}
        onChange={(event) => setTagColor(board, tag.id, event.target.value as TagColor)}
      />
      <span className="tag-row-actions">
        <Button variant="ghost" size="compact" disabled={disabled} onClick={onFocus}>
          {t("tags.select", { count })}
        </Button>
        <Button variant="ghost" size="compact"
          disabled={disabled}
          onClick={() => setConfirming(true)}>
          {t("tags.delete")}
        </Button>
      </span>
      {confirming && (
        <UiConfirmDialog
          title={t("tags.deleteTitle", { name: tag.name })}
          confirmLabel={t("tags.delete")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            deleteTag(board, tag.id);
          }}
        >
          {t("tags.deleteBody")}
        </UiConfirmDialog>
      )}
    </li>
  );
}
