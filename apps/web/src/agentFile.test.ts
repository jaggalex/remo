import { describe, expect, it } from "vitest";
import {
  TASK_FILE_LIMITS,
  TaskFileError,
  formatBytes,
  prepareAgentFile,
  taskFileErrorText,
  utf8Bytes,
} from "./agentFile";

const t = (key: string) => key;

function codeOf(run: () => unknown): string {
  try {
    run();
    return "OK";
  } catch (error) {
    return error instanceof TaskFileError ? error.code : "OTHER";
  }
}

describe("agent task file", () => {
  it("accepts the three brief formats and keeps the name", () => {
    expect(prepareAgentFile("stories.csv", "story,size\nLogin,M\n")).toMatchObject({
      name: "stories.csv",
      kind: "csv",
      chars: 19,
    });
    expect(prepareAgentFile("notes.md", "# Brief").kind).toBe("md");
    expect(prepareAgentFile("C:\\docs\\brief.txt", "hi").name).toBe("brief.txt");
  });

  it("measures bytes as UTF-8, not as JavaScript characters", () => {
    expect(utf8Bytes("привет")).toBe(12);
    expect(prepareAgentFile("brief.txt", "привет").bytes).toBe(12);
  });

  it("refuses the wrong type, an unreadable encoding and an oversized file", () => {
    expect(codeOf(() => prepareAgentFile("brief.pdf", "x"))).toBe("BAD_FILE_TYPE");
    expect(codeOf(() => prepareAgentFile("brief.txt", "a\u0000b"))).toBe("BAD_FILE_ENCODING");
    expect(codeOf(() => prepareAgentFile("brief.txt", "a\uFFFDb"))).toBe("BAD_FILE_ENCODING");
    expect(
      codeOf(() => prepareAgentFile("brief.txt", "a".repeat(TASK_FILE_LIMITS.bytes + 1))),
    ).toBe("FILE_TOO_LARGE");
    expect(codeOf(() => prepareAgentFile(`${"n".repeat(130)}.md`, "x"))).toBe("BAD_FILE_NAME");
  });

  it("translates every code into a sentence key", () => {
    expect(taskFileErrorText("BAD_FILE_TYPE", t)).toBe("agents.file.badType");
    expect(taskFileErrorText("FILE_TOO_LARGE", t)).toBe("agents.file.tooLarge");
    expect(taskFileErrorText("SOMETHING_ELSE", t)).toBe("agents.file.bad");
  });

  it("shows a readable size", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2_500)).toBe("2.5 KB");
    expect(formatBytes(120_000)).toBe("120 KB");
  });
});
