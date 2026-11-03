import type { TranslationKey } from "./i18n";

/**
 * The file half of a `brief-to-board` task, checked before it is sent.
 *
 * The server repeats every rule (`apps/sync/task-file.mjs`); this copy exists so a
 * person sees a sentence next to the field instead of a 422 after pressing Run. The
 * limits and codes are the same, and the file is sent as UTF-8 text — the original
 * bytes are never stored (ADR-142 "Untrusted content").
 */

export const TASK_FILE_LIMITS = Object.freeze({
  bytes: 100_000,
  chars: 20_000,
  name: 120,
});

export type TaskFileKind = "md" | "txt" | "csv";

export interface TaskFile {
  name: string;
  kind: TaskFileKind;
  content: string;
  bytes: number;
  chars: number;
}

export class TaskFileError extends Error {
  constructor(readonly code: TaskFileErrorCode, message = code) {
    super(message);
    this.name = "TaskFileError";
  }
}

export type TaskFileErrorCode =
  | "BAD_FILE"
  | "BAD_FILE_NAME"
  | "BAD_FILE_TYPE"
  | "BAD_FILE_ENCODING"
  | "FILE_TOO_LARGE";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function taskFileKind(name: string): TaskFileKind | null {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  const kind = match?.[1]?.toLowerCase() ?? "";
  return kind === "md" || kind === "txt" || kind === "csv" ? kind : null;
}

/** UTF-8 bytes, measured exactly as the server does after decoding. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function prepareAgentFile(name: string, content: string): TaskFile {
  const base = String(name ?? "").trim().split(/[\\/]/).pop() ?? "";
  if (!base) throw new TaskFileError("BAD_FILE");
  if (base.length > TASK_FILE_LIMITS.name) throw new TaskFileError("BAD_FILE_NAME");
  const kind = taskFileKind(base);
  if (!kind) throw new TaskFileError("BAD_FILE_TYPE");
  if (content.includes("\uFFFD") || CONTROL.test(content)) {
    throw new TaskFileError("BAD_FILE_ENCODING");
  }
  const text = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const bytes = utf8Bytes(text);
  if (bytes > TASK_FILE_LIMITS.bytes) throw new TaskFileError("FILE_TOO_LARGE");
  return { name: base, kind, content: text, bytes, chars: text.length };
}

const FILE_ERROR_KEYS: Record<string, TranslationKey> = {
  BAD_FILE: "agents.file.bad",
  BAD_FILE_NAME: "agents.file.badName",
  BAD_FILE_TYPE: "agents.file.badType",
  BAD_FILE_ENCODING: "agents.file.badEncoding",
  FILE_TOO_LARGE: "agents.file.tooLarge",
  BAD_CSV: "agents.file.badCsv",
  BAD_TEXT: "agents.file.badText",
};

/** A code from the browser check or the API, in the words a person can act on. */
export function taskFileErrorText(
  code: string,
  t: (key: TranslationKey) => string,
): string {
  return t(FILE_ERROR_KEYS[code as TaskFileErrorCode] ?? "agents.file.bad");
}

/** Human size for the field summary: no dependency, one decimal at most. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
