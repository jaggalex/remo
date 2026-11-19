import { describe, expect, it } from "vitest";
import { BoardDocument, createSticky, internalLinkTarget, safeExternalUrl, setWidgetLink } from "./board";
import { setLocked } from "./layers";

describe("object links", () => {
  it("accepts only http, https and mailto without credentials", () => {
    expect(safeExternalUrl("https://example.com/spec")).toBe("https://example.com/spec");
    expect(safeExternalUrl("mailto:team@example.com")).toBe("mailto:team@example.com");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,x")).toBeNull();
    expect(safeExternalUrl("ftp://example.com")).toBeNull();
    expect(safeExternalUrl("https://user:pass@example.com")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
  });

  it("stores an internal link only when the target exists and is not itself", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    createSticky(board, "b", { x: 200, y: 0 });

    expect(setWidgetLink(board, "a", { kind: "widget", widgetId: "b" })).toBe(true);
    expect(internalLinkTarget(board, "a")).toBe("b");
    expect(setWidgetLink(board, "a", { kind: "widget", widgetId: "a" })).toBe(false);
    expect(setWidgetLink(board, "a", { kind: "widget", widgetId: "missing" })).toBe(false);

    expect(setWidgetLink(board, "a", { kind: "url", url: "https://example.com" })).toBe(true);
    expect(board.widgets.get("a")!.link).toEqual({ kind: "url", url: "https://example.com/" });

    setWidgetLink(board, "a", null);
    expect(board.widgets.get("a")!.link).toBeUndefined();
  });
});

describe("links on a locked object", () => {
  it("refuses to add or clear a link", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    createSticky(board, "b", { x: 200, y: 0 });
    setWidgetLink(board, "a", { kind: "url", url: "https://example.com" });
    setLocked(board, ["a"], true);

    expect(setWidgetLink(board, "a", { kind: "widget", widgetId: "b" })).toBe(false);
    expect(setWidgetLink(board, "a", null)).toBe(false);
    expect(board.widgets.get("a")!.link).toEqual({ kind: "url", url: "https://example.com/" });
  });
});
