import { useEffect, useState } from "react";
import { TEMPLATE_KEYS, type TemplateKey } from "@remo/model";
import { api, ApiError, type OrgSummary } from "./api";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import { TEMPLATE_LABEL_KEY } from "./templateLabels";

/** A template choice is one of the four authored templates plus an empty board. */
type Choice = "empty" | TemplateKey;

/**
 * Create a board from the board list.
 *
 * The server owns the decision (`board.create`, ADR-100); this dialog only asks for a
 * name, a team and a starting point. The new room is opened with `?template=`, and the
 * document seeds itself once sync has confirmed it is empty.
 */
export function NewBoardDialog({
  open,
  orgs,
  defaultOrgId = null,
  initialTemplate = "empty",
  onClose,
  onCreated,
}: {
  open: boolean;
  orgs: OrgSummary[];
  /** The directory filter, so a new board starts in the organisation being viewed. */
  defaultOrgId?: string | null;
  /** The home's example link preselects an authored template; the default is empty. */
  initialTemplate?: "empty" | TemplateKey;
  onClose: () => void;
  onCreated: (boardId: string, template: Choice, title: string) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [orgId, setOrgId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [template, setTemplate] = useState<Choice>("empty");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = orgs.filter((org) => org.capabilities?.includes("board.create"));

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTemplate(initialTemplate);
    setError(null);
    setTeamId("");
    setTeams([]);
    const preferred = canCreate.find((org) => org.id === defaultOrgId) ?? canCreate[0];
    setOrgId(preferred?.id ?? "");
  }, [open, defaultOrgId, initialTemplate]);

  // Teams are per organisation; reload them when the selection changes.
  useEffect(() => {
    if (!open || !orgId) return;
    let alive = true;
    api
      .teams(orgId)
      .then((result) => {
        if (!alive) return;
        setTeams(result.teams);
        setTeamId(result.teams[0]?.id ?? "");
      })
      .catch(() => {
        if (alive) setTeams([]);
      });
    return () => {
      alive = false;
    };
  }, [open, orgId]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBoard(orgId, {
        title: title.trim(),
        ...(teamId ? { teamId } : {}),
      });
      onCreated(created.board.id, template, title.trim());
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setError(
        code === "BOARD_CREATE_FORBIDDEN"
          ? t("newBoard.forbidden")
          : code === "TEAM_REQUIRED"
            ? t("newBoard.teamRequired")
            : code === "ORG_NAME_REQUIRED"
              ? t("newBoard.titleRequired")
              : t("newBoard.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="auth-dialog new-board-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("newBoard.title")}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2>
          {t("newBoard.title")} <HelpLink topicId="rooms.create" />
        </h2>

        <label className="auth-field">
          <span>{t("newBoard.name")}</span>
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            placeholder={t("newBoard.namePlaceholder")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        {canCreate.length > 1 && (
          <label className="auth-field">
            <span>{t("newBoard.org")}</span>
            <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
              {canCreate.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {teams.length > 1 && (
          <label className="auth-field">
            <span>{t("newBoard.team")}</span>
            <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Two equal choices, not a list: an empty room or one with an example. The
            example list appears only once "With an example" is chosen (P2). */}
        <fieldset className="new-board-start">
          <legend>{t("newBoard.template")}</legend>
          <div className="new-board-cards">
            {(["empty", "example"] as const).map((kind) => {
              const checked = kind === "empty" ? template === "empty" : template !== "empty";
              return (
                <label key={kind} className={`new-board-card${checked ? " is-checked" : ""}`}>
                  <input
                    type="radio"
                    name="new-board-start"
                    checked={checked}
                    onChange={() =>
                      setTemplate(kind === "empty" ? "empty" : (TEMPLATE_KEYS[0] as Choice))
                    }
                  />
                  <b>{t(kind === "empty" ? "newBoard.template.empty" : "newBoard.start.example")}</b>
                  <span>
                    {t(kind === "empty" ? "newBoard.start.emptyHint" : "newBoard.start.exampleHint")}
                  </span>
                </label>
              );
            })}
          </div>
          {template !== "empty" && (
            <label className="auth-field">
              <span>{t("newBoard.start.which")}</span>
              <select
                value={template}
                onChange={(event) => setTemplate(event.target.value as Choice)}
              >
                {TEMPLATE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t(TEMPLATE_LABEL_KEY[key])}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        {error && <p className="auth-error">{error}</p>}

        <div className="auth-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
            {t("newBoard.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !orgId}>
            {busy ? t("newBoard.creating") : t("newBoard.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
