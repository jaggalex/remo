import { useRef, useState } from "react";
import { Button, IconButton } from "@remo/ui";
import {
  TaskFileError,
  formatBytes,
  prepareAgentFile,
  taskFileErrorText,
  type TaskFile,
} from "./agentFile";
import { useI18n } from "./i18n";

/**
 * One optional `.md`, `.txt` or `.csv` file for a brief.
 *
 * The browser checks the same door as the server — extension, UTF-8, 100 000 bytes —
 * and says why in words. A refusal clears the field rather than leaving a file that
 * looks attached but will fail after the model call.
 */
export function AgentFileField({
  file,
  onFile,
  error,
  onError,
  disabled,
}: {
  file: TaskFile | null;
  onFile: (file: TaskFile | null) => void;
  error: string | null;
  onError: (code: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (candidate: File | undefined) => {
    if (!candidate) return;
    setBusy(true);
    try {
      const text = await candidate.text();
      onFile(prepareAgentFile(candidate.name, text));
      onError(null);
    } catch (failure) {
      onFile(null);
      onError(failure instanceof TaskFileError ? failure.code : "BAD_FILE");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agent-file">
      <input
        ref={input}
        type="file"
        accept=".md,.txt,.csv,text/markdown,text/plain,text/csv"
        className="agent-file-input"
        disabled={disabled || busy}
        onChange={(event) => {
          const candidate = event.target.files?.[0];
          event.target.value = "";
          void choose(candidate);
        }}
      />
      <div className="agent-file-row">
        <Button
          variant="secondary"
          size="compact"
          onClick={() => input.current?.click()}
          disabled={disabled || busy}
        >
          {file ? t("agents.file.replace") : t("agents.file.attach")}
        </Button>
        {file ? (
          <span className="agent-file-chip">
            <span className="agent-file-name">{file.name}</span>
            <span className="muted">
              {formatBytes(file.bytes)} · .{file.kind}
            </span>
            <IconButton
              icon="close"
              label={t("agents.file.remove")}
              size="compact"
              onClick={() => {
                onFile(null);
                onError(null);
              }}
            />
          </span>
        ) : (
          <span className="muted">{t("agents.file.none")}</span>
        )}
      </div>
      <p className="muted agent-file-limits">{t("agents.file.limits")}</p>
      {error && (
        <p className="auth-error" role="alert">
          {taskFileErrorText(error, t)}
        </p>
      )}
    </div>
  );
}
