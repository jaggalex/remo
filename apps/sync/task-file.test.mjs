import { describe, expect, it } from "vitest";
import {
  TASK_INPUT_LIMITS,
  csvToText,
  parseCsv,
  prepareTaskFile,
  prepareTaskInputs,
} from "./task-file.mjs";

/**
 * The door for a brief's text and file (ADR-142 "Untrusted content").
 */

const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code ?? `unexpected:${error.message}`;
  }
};

describe("CSV is read without a dependency", () => {
  it("keeps quoted commas, doubled quotes and CRLF", () => {
    const rows = parseCsv('name,note\r\nA,"one, two"\r\nB,"say ""hi"""\r\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["A", "one, two"],
      ["B", 'say "hi"'],
    ]);
  });

  it("flattens rows into header: value lines", () => {
    const text = csvToText("\uFEFFstory,owner,size\nLogin,Ann,M\nExport,Bob,L\n");
    expect(text).toBe("story: Login | owner: Ann | size: M\nstory: Export | owner: Bob | size: L");
  });

  it("refuses an empty table with a readable code", () => {
    expect(codeOf(() => csvToText(" , \n"))).toBe("BAD_CSV");
  });
});

describe("attached files", () => {
  it("accepts md, txt and csv and keeps the extracted text as plain text", () => {
    const markdown = prepareTaskFile({ name: "brief.md", content: "# Plan\n\n- one" });
    expect(markdown).toMatchObject({ source: "file", kind: "md", truncated: false });
    expect(markdown.content).toBe("# Plan\n\n- one");

    const csv = prepareTaskFile({
      name: "stories.csv",
      content: "story,size\nLogin,M\nExport,L\n",
    });
    expect(csv.kind).toBe("csv");
    expect(csv.content).toContain("story: Login");
    expect(csv.bytes).toBe(Buffer.byteLength("story,size\nLogin,M\nExport,L\n", "utf8"));
  });

  it("refuses another format, an empty name and invalid UTF-8 in words", () => {
    expect(codeOf(() => prepareTaskFile({ name: "brief.pdf", content: "x" }))).toBe(
      "BAD_FILE_TYPE",
    );
    expect(codeOf(() => prepareTaskFile({ name: "", content: "x" }))).toBe("BAD_FILE");
    // U+FFFD is what a decoder produces for invalid bytes; accepting it would send
    // mojibake to the model and hide the real problem from the person.
    expect(codeOf(() => prepareTaskFile({ name: "brief.txt", content: "bad \uFFFD" }))).toBe(
      "BAD_FILE_ENCODING",
    );
    expect(codeOf(() => prepareTaskFile({ name: "brief.txt", content: "bad \u0000" }))).toBe(
      "BAD_FILE_ENCODING",
    );
  });

  it("refuses a file above the byte limit and names both numbers", () => {
    const content = "a".repeat(TASK_INPUT_LIMITS.bytes + 1);
    let message = "";
    try {
      prepareTaskFile({ name: "big.txt", content });
    } catch (error) {
      expect(error.code).toBe("FILE_TOO_LARGE");
      message = error.message;
    }
    expect(message).toContain(String(TASK_INPUT_LIMITS.bytes));
  });

  it("truncates a 10 000-row table at a line boundary and records the code", () => {
    const lines = ["story,size"];
    for (let index = 0; index < 10_000; index += 1) lines.push("S,M");
    const file = prepareTaskFile({ name: "huge.csv", content: lines.join("\n") });
    expect(file.truncated).toBe(true);
    expect(file.truncation_code).toBe("TASK_INPUT_TRUNCATED");
    expect(file.chars).toBeLessThanOrEqual(TASK_INPUT_LIMITS.chars + 64);
    expect(file.content.endsWith("[truncated]")).toBe(true);
  });
});

describe("a file built to expand", () => {
  it("reads columns times rows without building the whole product", () => {
    // 64 KB of commas and short rows: about 15 GB of strings if built in full (ADR-160).
    const content = `h${",".repeat(31_999)}\n${"a\n".repeat(10_600)}`;
    const before = process.memoryUsage().heapUsed;
    const text = csvToText(content);
    expect(text.length).toBeLessThanOrEqual(TASK_INPUT_LIMITS.chars + 2 * TASK_INPUT_LIMITS.cell);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(200 * 1024 * 1024);

    const file = prepareTaskFile({ name: "wide.csv", content });
    expect(file.truncated).toBe(true);
    expect(file.content.endsWith("[truncated]")).toBe(true);
  });

  it("keeps a table that fits complete", () => {
    expect(csvToText("a,b\n1,2\n3,4\n")).toBe("a: 1 | b: 2\na: 3 | b: 4");
  });

  it("keeps a table of exactly the limit, and marks one character more", () => {
    // Whole rows of `a: ` plus 1000 cells and a newline, then one row that fills the rest.
    const rowLength = "a: ".length + 1000 + 1;
    const rows = Math.floor(TASK_INPUT_LIMITS.chars / rowLength);
    const last = "x".repeat(TASK_INPUT_LIMITS.chars - rows * rowLength - "a: ".length);
    const table = `a\n${`${"x".repeat(1000)}\n`.repeat(rows)}`;
    const fits = `${table}${last}\n`;
    expect(csvToText(fits)).toHaveLength(TASK_INPUT_LIMITS.chars);
    expect(prepareTaskFile({ name: "fits.csv", content: fits }).truncated).toBe(false);

    const over = `${table}${last}x\n`;
    expect(prepareTaskFile({ name: "over.csv", content: over }).truncated).toBe(true);
  });
});

describe("task inputs", () => {
  it("returns metadata that never carries the text", () => {
    const { inputs, meta } = prepareTaskInputs({
      text: "Build a checkout flow",
      file: { name: "notes.txt", content: "keep it short" },
    });
    expect(inputs).toHaveLength(2);
    expect(meta.text).toMatchObject({ kind: "text", truncated: false });
    expect(meta.file).toMatchObject({ name: "notes.txt", kind: "txt" });
    expect(JSON.stringify(meta)).not.toContain("checkout");
    expect(JSON.stringify(meta)).not.toContain("keep it short");
  });

  it("ignores an absent or empty text and refuses a non-string one", () => {
    expect(prepareTaskInputs({}).inputs).toEqual([]);
    expect(prepareTaskInputs({ text: "   " }).inputs).toEqual([]);
    expect(codeOf(() => prepareTaskInputs({ text: { evil: true } }))).toBe("BAD_TEXT");
  });

  it("keeps only the base name of a path", () => {
    const file = prepareTaskFile({ name: "../../etc/brief.md", content: "x" });
    expect(file.name).toBe("brief.md");
  });
});
