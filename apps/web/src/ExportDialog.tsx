import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadBoard,
  setWidgetDelta,
  type BoardDocument,
} from "@remo/doc";
import type { Board, KanbanState, TextDeltaOp, Widget } from "@remo/model";
import { api, ApiError } from "./api";
import { backupToBoard, BackupError, verifyBoardBackup } from "./backupFormat";
import { commentsApi, type BackupCommentThread, type CommentThread } from "./commentsApi";
import { canvasPaletteFromTokens } from "./canvasPalette";
import {
  buildPdfFromJpeg,
  canvasToBlob,
  frameForSelection,
  renderScope,
  scopeWidgets,
  type ExportScope,
} from "./exportRender";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";
import type { BoardSettings } from "./settings";

type Format = "png" | "pdf" | "backup";
type Status = "idle" | "running" | "done" | "error";

interface PendingImport {
  filename: string;
  board: Board;
  kanbanStates: Record<string, KanbanState>;
  textDeltas: Record<string, TextDeltaOp[]>;
  comments: BackupCommentThread[];
  objects: number;
}

/**
 * Export and backup (ADR-071).
 *
 * Scope comes before format because "may look at it" and "may take the whole board
 * away" are different grants. A backup is always the whole board; a picture is exactly
 * what the person chose. The dialog never starts from an implicit whole board: with a
 * selection it preselects that, otherwise the person picks a scope explicitly.
 */
export function ExportDialog({
  open,
  boardId,
  boardTitle,
  board,
  widgets,
  kanbanStates,
  selectedIds,
  settings,
  canExport,
  canBackup,
  canImport,
  restoreRequest,
  onClose,
  onImported,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  board: BoardDocument;
  widgets: Widget[];
  kanbanStates: Record<string, KanbanState>;
  selectedIds: readonly string[];
  settings: BoardSettings;
  canExport: boolean;
  canBackup: boolean;
  canImport: boolean;
  /**
   * Increments when the board menu asked for a restore: the dialog then opens on its
   * restore section. The separate `RestoreDialog` of ADR-122 is stage S3, so until then
   * one entry point leads here instead of two copies of the same verify-and-replace code.
   */
  restoreRequest?: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t, count } = useI18n();
  const [scope, setScope] = useState<ExportScope | null>(null);
  const [format, setFormat] = useState<Format>("png");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [includeComments, setIncludeComments] = useState(true);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const importSection = useRef<HTMLElement | null>(null);

  const frame = useMemo(
    () => frameForSelection(widgets, selectedIds),
    [widgets, selectedIds],
  );

  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.length ? "selection" : null);
    setFormat(canExport ? "png" : "backup");
    setStatus("idle");
    setProgress(0);
    setError(null);
    setJobId(null);
    setPendingImport(null);
    setImportError(null);
    setImportBusy(false);
    // The reset is about opening, not about every change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A restore request scrolls to the one place that replaces the board.
  useEffect(() => {
    if (!open || !restoreRequest || !canImport) return;
    importSection.current?.scrollIntoView({ block: "nearest" });
    importSection.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [canImport, open, restoreRequest]);

  const effectiveScope: ExportScope | null = format === "backup" ? "board" : scope;
  const scoped = useMemo(
    () =>
      effectiveScope ? scopeWidgets(widgets, selectedIds, effectiveScope) : [],
    [widgets, selectedIds, effectiveScope],
  );
  const objectCount = format === "backup" ? widgets.length : scoped.length;

  const canRun =
    status !== "running" &&
    (format === "backup" ? canBackup : canExport) &&
    Boolean(effectiveScope) &&
    objectCount > 0;

  if (!open) return null;

  const failureText = (failure: unknown) => {
    const code = failure instanceof ApiError ? failure.code : "";
    if (code === "FORBIDDEN") return t("export.forbidden");
    if (failure instanceof Error && failure.message === "EMPTY_SCOPE") {
      return t("export.emptyScope");
    }
    if (failure instanceof Error && failure.message === "CANVAS_EMPTY") {
      return t("export.canvasFailed");
    }
    return t("export.failed");
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // A revoked URL after a tick still lets the browser start the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const run = async () => {
    if (!canRun || !effectiveScope) return;
    setStatus("running");
    setError(null);
    setProgress(0.05);
    try {
      if (format === "backup") {
        const result = await api.downloadBackup(boardId);
        download(result.blob, result.filename);
        setProgress(1);
        setStatus("done");
        return;
      }

      let currentJob = jobId;
      if (!currentJob) {
        const created = await api.createExportJob(boardId, {
          scope: effectiveScope,
          format,
          objectCount,
        });
        currentJob = created.jobId;
        setJobId(currentJob);
      }
      setProgress(0.25);

      await document.fonts?.ready;
      const palette = canvasPaletteFromTokens();
      let comments: CommentThread[] = [];
      if (includeComments) {
        // The discussion is a server read; a failure must not block the picture.
        comments = await commentsApi.list(boardId).then((result) => result.threads).catch(() => []);
      }
      const rendered = renderScope({
        widgets,
        kanbanStates,
        selectedIds,
        scope: effectiveScope,
        settings,
        comments,
        includeComments,
        commentsTitle: t("export.commentsTitle"),
        commentPointLabel: t("export.commentsPoint"),
        theme: {
          fontFamily: settings.text.fontFamily,
          fontCap: settings.notes.fontCap,
          shapeStrokeWidth: settings.shapes.strokeWidth,
          cardPlaceholder: t("kanban.cardPlaceholder"),
          timerExpired: t("facilitation.timer.timeUp"),
          cardStatus: {
            todo: t("card.status.todo"),
            in_progress: t("card.status.in_progress"),
            done: t("card.status.done"),
          },
          palette,
        },
      });
      if (!rendered) throw new Error("EMPTY_SCOPE");
      setProgress(0.65);

      if (format === "png") {
        const blob = await canvasToBlob(rendered.canvas, "image/png");
        await api.completeExportJob(boardId, currentJob, blob.size);
        download(blob, filenameFor(boardTitle, "png"));
      } else {
        const jpeg = await canvasToBlob(rendered.canvas, "image/jpeg", 0.92);
        const bytes = new Uint8Array(await jpeg.arrayBuffer());
        const pdf = buildPdfFromJpeg(bytes, rendered.width, rendered.height);
        await api.completeExportJob(boardId, currentJob, pdf.size);
        download(pdf, filenameFor(boardTitle, "pdf"));
      }
      setProgress(1);
      setStatus("done");
      setJobId(null);
    } catch (failure) {
      // The job id stays, so "retry" resumes the same audited request instead of
      // creating a second `export.requested` for one click.
      setError(failureText(failure));
      setStatus("error");
    }
  };

  const chooseFile = async (file: File) => {
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const bundle = await verifyBoardBackup(parsed);
      const { board: model, kanbanStates: states, textDeltas, comments } = backupToBoard(bundle);
      setPendingImport({
        filename: file.name,
        board: model,
        kanbanStates: states,
        textDeltas,
        comments: comments as BackupCommentThread[],
        objects: model.widgets.length,
      });
    } catch (failure) {
      setPendingImport(null);
      if (failure instanceof BackupError) {
        setImportError(
          failure.code === "NOT_A_BACKUP"
            ? t("export.importWrongFormat")
            : failure.code === "VERSION"
              ? t("export.importVersion")
              : failure.code === "CHECKSUM"
                ? t("export.importChecksum")
                : t("export.importShape"),
        );
        return;
      }
      setImportError(t("export.importWrongFormat"));
    }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setImportBusy(true);
    setImportError(null);
    loadBoard(board, pendingImport.board, pendingImport.kanbanStates);
    for (const [id, delta] of Object.entries(pendingImport.textDeltas)) {
      setWidgetDelta(board, id, delta);
    }
    board.undo.clear();
    try {
      // The discussion is a server-side sibling of the document (ADR-104 amendment),
      // so replacing the board must replace it too; an empty backup clears it.
      await commentsApi.restore(boardId, pendingImport.comments ?? []);
    } catch (failure) {
      setImportError(failure instanceof Error ? failure.message : String(failure));
      setImportBusy(false);
      return;
    }
    setPendingImport(null);
    setImportBusy(false);
    onImported();
  };

  const scopeOption = (
    value: ExportScope,
    title: string,
    hint: string,
    disabled: boolean,
    selected: boolean,
  ) => (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`export-choice${selected ? " selected" : ""}`}
      disabled={disabled || format === "backup" || status === "running"}
      onClick={() => setScope(value)}
    >
      <strong>{title}</strong>
      <span>{hint}</span>
    </button>
  );

  const formatOption = (value: Format, title: string, hint: string, enabled: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={format === value}
      className={`export-choice${format === value ? " selected" : ""}`}
      disabled={!enabled || status === "running"}
      onClick={() => setFormat(value)}
    >
      <strong>{title}</strong>
      <span>{hint}</span>
    </button>
  );

  const statusLabel =
    status === "running"
      ? progress < 0.3
        ? t("export.preparing")
        : progress < 0.7
          ? t("export.rendering")
          : t("export.saving")
      : status === "done"
        ? t("export.done")
        : t("export.failed");

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="share-dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("export.title")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="share-head">
          <div>
            <h2>
              {t("export.title")} <HelpLink topicId="export.formats" />
            </h2>
            <p className="muted">{boardTitle || t("board.untitled")}</p>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label={t("export.close")}
          >
            ×
          </button>
        </header>

        <section className="export-section">
          <h3>
            {t("export.scopeTitle")} <HelpLink topicId="export.scope" />
          </h3>
          <div className="export-choices" role="radiogroup" aria-label={t("export.scopeTitle")}>
            {scopeOption(
              "selection",
              t("export.scope.selection"),
              selectedIds.length
                ? count("selected", selectedIds.length)
                : t("export.scope.selectionEmpty"),
              selectedIds.length === 0,
              effectiveScope === "selection",
            )}
            {scopeOption(
              "frame",
              t("export.scope.frame"),
              frame ? frame.title || t("export.scope.frameHint") : t("export.scope.frameEmpty"),
              !frame,
              effectiveScope === "frame",
            )}
            {scopeOption(
              "board",
              t("export.scope.board"),
              count("objects", widgets.length),
              false,
              effectiveScope === "board",
            )}
          </div>
          {format === "backup" && (
            <p className="muted export-note">{t("export.backupWholeBoard")}</p>
          )}
          {effectiveScope && (
            <p className="muted export-note">{count("objects", objectCount)}</p>
          )}
        </section>

        <section className="export-section">
          <h3>{t("export.formatTitle")}</h3>
          <div className="export-choices" role="radiogroup" aria-label={t("export.formatTitle")}>
            {formatOption("png", t("export.format.png"), t("export.format.pngHint"), canExport)}
            {formatOption("pdf", t("export.format.pdf"), t("export.format.pdfHint"), canExport)}
            {canBackup &&
              formatOption(
                "backup",
                t("export.format.backup"),
                t("export.format.backupHint"),
                canBackup,
              )}
          </div>
        </section>

        {format !== "backup" && (
          <label className="export-comments">
            <input
              type="checkbox"
              checked={includeComments}
              onChange={(event) => setIncludeComments(event.target.checked)}
            />
            {t("export.includeComments")}
          </label>
        )}

        {status !== "idle" && (
          <div className={`export-status ${status}`} aria-live="polite">
            <div className="export-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>{statusLabel}</span>
          </div>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <footer className="export-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("export.close")}
          </button>
          <button
            type="button"
            className="share-button"
            onClick={() => void run()}
            disabled={!canRun}
          >
            {status === "error"
              ? t("export.retry")
              : status === "running"
                ? t("export.running")
                : t("export.start")}
          </button>
        </footer>

        {canImport && (
          <section className="export-section export-import" ref={importSection}>
            <h3>
              {t("export.importTitle")} <HelpLink topicId="export.backup" />
            </h3>
            <p className="muted">{t("export.importHint")}</p>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void chooseFile(file);
              }}
            />
            {!pendingImport ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => fileInput.current?.click()}
                disabled={importBusy || status === "running"}
              >
                {t("export.importChoose")}
              </button>
            ) : (
              <div className="export-import-confirm">
                <p className="auth-error" role="alert">
                  {t("export.importConfirm", {
                    name: pendingImport.filename,
                    count: pendingImport.objects,
                  })}
                </p>
                <div className="export-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setPendingImport(null)}
                    disabled={importBusy}
                  >
                    {t("export.cancel")}
                  </button>
                  <button
                    type="button"
                    className="share-button"
                    onClick={confirmImport}
                    disabled={importBusy}
                  >
                    {t("export.importReplace")}
                  </button>
                </div>
              </div>
            )}
            {importError && (
              <p className="auth-error" role="alert">
                {importError}
              </p>
            )}
          </section>
        )}
      </section>
    </div>
  );
}

/** The same slug the server uses, so a downloaded file is recognizable. */
function filenameFor(title: string, extension: "png" | "pdf"): string {
  const slug =
    String(title || "board")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "board";
  return `${slug}.${extension}`;
}
