import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { BoardDocument, loadBoard } from "./board";
import {
  MAX_ALT,
  MAX_IMAGE_SIDE,
  fitImageToNaturalSize,
  replaceImageFile,
  setImageAlt,
} from "./images";

/**
 * The image object after creation (ADR-249, §3.2, §9.5).
 *
 * Creation is a server command; everything here is a document edit, so it is tested
 * without a database: description cap, replacement keeps the width, "original size"
 * respects the 2048 ceiling.
 */

function boardWith(widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  loadBoard(board, { id: "t", title: "Images", widgets }, {});
  return board;
}

function picture(overrides: Partial<Widget> = {}): Widget {
  return {
    id: "img",
    type: "image",
    parentId: null,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    fileId: "f-1",
    naturalWidth: 1600,
    naturalHeight: 1200,
    dominantColor: "#c0ffee",
    ...overrides,
  };
}

describe("setImageAlt", () => {
  it("stores a trimmed description and clears it when empty", () => {
    const board = boardWith([picture()]);
    setImageAlt(board, "img", "  Схема воронки  ");
    expect(board.readWidget("img")?.alt).toBe("Схема воронки");

    setImageAlt(board, "img", "   ");
    expect(board.readWidget("img")?.alt).toBeUndefined();
  });

  it("caps the description at 500 characters", () => {
    const board = boardWith([picture()]);
    setImageAlt(board, "img", "a".repeat(MAX_ALT + 40));
    expect(board.readWidget("img")?.alt).toHaveLength(MAX_ALT);
  });

  it("never touches a widget that is not an image", () => {
    const board = boardWith([
      { id: "note", type: "sticky_note", parentId: null, x: 0, y: 0, width: 10, height: 10 },
    ]);
    setImageAlt(board, "note", "text");
    expect(board.readWidget("note")?.alt).toBeUndefined();
  });
});

describe("replaceImageFile", () => {
  it("keeps the width, follows the new proportion and keeps the centre", () => {
    const board = boardWith([picture()]);
    expect(
      replaceImageFile(board, "img", {
        fileId: "f-2",
        naturalWidth: 1000,
        naturalHeight: 500,
        dominantColor: "#123456",
      }),
    ).toBe(true);
    const next = board.readWidget("img")!;
    expect(next.fileId).toBe("f-2");
    expect(next.width).toBe(400);
    expect(next.height).toBe(200);
    expect(next.x).toBe(100);
    expect(next.dominantColor).toBe("#123456");
    // The old natural size is gone: the "original size" action reads the new file.
    expect(next.naturalWidth).toBe(1000);
  });

  it("refuses a locked object", () => {
    const board = boardWith([picture({ locked: true })]);
    expect(
      replaceImageFile(board, "img", { fileId: "f-2", naturalWidth: 10, naturalHeight: 10 }),
    ).toBe(false);
    expect(board.readWidget("img")?.fileId).toBe("f-1");
  });
});

describe("fitImageToNaturalSize", () => {
  it("grows a small picture to its own pixels", () => {
    const board = boardWith([picture({ width: 200, height: 150 })]);
    fitImageToNaturalSize(board, "img");
    expect(board.readWidget("img")).toMatchObject({ width: 1600, height: 1200 });
  });

  it("stops at the 2048 ceiling and keeps the proportion", () => {
    const board = boardWith([picture({ naturalWidth: 6000, naturalHeight: 3000 })]);
    fitImageToNaturalSize(board, "img");
    const next = board.readWidget("img")!;
    expect(next.width).toBe(MAX_IMAGE_SIDE);
    expect(next.height).toBe(1024);
  });
});
