/**
 * The text a person gives an agent task: its own wording and one attached file.
 *
 * Both are **data** for the model, never instructions (ADR-142 "Untrusted content").
 * A file is read as UTF-8, accepted only as `.md`, `.txt` or `.csv`, limited before it
 * is parsed, and reduced to plain text. CSV has no dependency: the same small parser
 * every runtime can carry turns rows into `header: value` lines, which is the shape a
 * model reads better than commas.
 */

export const TASK_INPUT_LIMITS = Object.freeze({
  /** Bytes of the uploaded text, before parsing. */
  bytes: 100_000,
  /** Characters kept after extraction; the rest is reported as truncated. */
  chars: 20_000,
  /** File name shown to the person and recorded with the task. */
  name: 120,
  /** A cell longer than this is cut: one runaway cell must not crowd out the rest. */
  cell: 2_000,
});

export class TaskInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TaskInputError";
    this.code = code;
  }
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function withoutBom(value) {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

/** A readable string, or a refusal that says what to do about it. */
function cleanUtf8(value, label) {
  if (typeof value !== "string") {
    throw new TaskInputError(
      "BAD_FILE",
      `${label} must be text; save the file as UTF-8 and attach it again`,
    );
  }
  if (value.includes("\uFFFD") || CONTROL.test(value)) {
    throw new TaskInputError(
      "BAD_FILE_ENCODING",
      `${label} is not plain UTF-8 text; save it as UTF-8 (without control characters) and attach it again`,
    );
  }
  return withoutBom(value);
}

function baseName(value) {
  const name = String(value ?? "").trim().split(/[\\/]/).pop() ?? "";
  if (!name) {
    throw new TaskInputError("BAD_FILE", "the file needs a name ending in .md, .txt or .csv");
  }
  if (name.length > TASK_INPUT_LIMITS.name) {
    throw new TaskInputError(
      "BAD_FILE_NAME",
      `the file name is longer than ${TASK_INPUT_LIMITS.name} characters`,
    );
  }
  return name;
}

function kindOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  const kind = match ? match[1].toLowerCase() : "";
  if (kind !== "md" && kind !== "txt" && kind !== "csv") {
    throw new TaskInputError(
      "BAD_FILE_TYPE",
      "attach a .md, .txt or .csv file; other formats are not read",
    );
  }
  return kind;
}

/**
 * Cut at a line boundary and say so.
 *
 * A model that never sees the end of a file can still plan from the beginning; a file
 * silently missing half its lines cannot be trusted. The marker is part of the data,
 * and `truncated` is recorded on the task.
 */
function limitText(value) {
  const text = value.replace(/\r\n?/g, "\n");
  if (text.length <= TASK_INPUT_LIMITS.chars) {
    return { content: text, truncated: false, truncationCode: null };
  }
  const head = text.slice(0, TASK_INPUT_LIMITS.chars);
  const cut = head.lastIndexOf("\n");
  const content = `${cut > TASK_INPUT_LIMITS.chars / 2 ? head.slice(0, cut) : head}\n\n[truncated]`;
  return { content, truncated: true, truncationCode: "TASK_INPUT_TRUNCATED" };
}

/** RFC 4180 enough for a brief: quotes, doubled quotes, commas and CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Rows → `Header: value | Header: value` lines. The first row names the columns. */
export function csvToText(text) {
  const rows = parseCsv(withoutBom(text));
  if (rows.length === 0) {
    throw new TaskInputError("BAD_CSV", "the CSV file has no rows to read");
  }
  const headers = rows[0].map((cell, index) => cell.trim() || `column ${index + 1}`);
  const body = rows.slice(1);
  if (body.length === 0) {
    return headers.map((header, index) => `${header}: ${rows[0][index].trim()}`).join(" | ");
  }
  // Every row repeats every header, so a small file can expand by its columns times its
  // rows: 64 KB reached gigabytes and a heap failure no handler can catch (ADR-160). Only
  // the first `chars` survive `prepareTaskFile`, so nothing past them is built.
  const lines = [];
  // Exactly the length of the joined text: stopping early on an estimate would drop rows
  // from a file that fits, and without the `truncated` mark.
  let length = -1;
  for (const cells of body) {
    const parts = [];
    length += 1;
    for (let index = 0; index < headers.length && length <= TASK_INPUT_LIMITS.chars; index += 1) {
      const value = (cells[index] ?? "").trim().slice(0, TASK_INPUT_LIMITS.cell);
      const part = `${headers[index]}: ${value}`;
      length += part.length + (index > 0 ? 3 : 0);
      parts.push(part);
    }
    lines.push(parts.join(" | "));
    if (length > TASK_INPUT_LIMITS.chars) break;
  }
  return lines.join("\n");
}

export function prepareTaskText(value) {
  const text = cleanUtf8(value, "the task text");
  const limited = limitText(text);
  return {
    source: "text",
    name: "",
    kind: "text",
    content: limited.content,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: limited.content.length,
    truncated: limited.truncated,
    truncation_code: limited.truncationCode,
  };
}

export function prepareTaskFile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TaskInputError("BAD_FILE", "the file needs a name and its content");
  }
  const name = baseName(input.name);
  const kind = kindOf(name);
  const text = cleanUtf8(input.content, `"${name}"`);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > TASK_INPUT_LIMITS.bytes) {
    throw new TaskInputError(
      "FILE_TOO_LARGE",
      `"${name}" is ${bytes} bytes; attach at most ${TASK_INPUT_LIMITS.bytes} bytes`,
    );
  }
  const extracted = kind === "csv" ? csvToText(text) : text;
  const limited = limitText(extracted);
  return {
    source: "file",
    name,
    kind,
    content: limited.content,
    bytes,
    chars: limited.content.length,
    truncated: limited.truncated,
    truncation_code: limited.truncationCode,
  };
}

/**
 * Validate both inputs at the door, so a task is never created around a file the
 * runtime would refuse later. Returns stored rows (with content) and the metadata the
 * task may show without exposing the text.
 */
export function prepareTaskInputs({ text, file } = {}) {
  const inputs = [];
  if (text !== undefined && text !== null) {
    if (typeof text !== "string") {
      throw new TaskInputError("BAD_TEXT", "the task text must be a string");
    }
    if (text.trim() !== "") inputs.push(prepareTaskText(text));
  }
  if (file !== undefined && file !== null) {
    inputs.push(prepareTaskFile(file));
  }
  const meta = {};
  for (const input of inputs) {
    meta[input.source] = {
      name: input.name,
      kind: input.kind,
      chars: input.chars,
      bytes: input.bytes,
      truncated: input.truncated,
      ...(input.truncation_code ? { truncationCode: input.truncation_code } : {}),
    };
  }
  return { inputs, meta };
}
