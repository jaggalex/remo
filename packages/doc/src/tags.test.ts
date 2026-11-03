import { describe, expect, it } from "vitest";
import { BoardDocument, createSticky, createTag, deleteTag, renameTag, setWidgetTags, toggleWidgetTag, widgetsWithTag } from "./board";
import { setLocked } from "./layers";

describe("board tags", () => {
  it("creates, renames and deletes a tag without duplicating it on objects", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    createSticky(board, "b", { x: 200, y: 0 });

    const tag = createTag(board, "Priority", "blue")!;
    expect(tag.name).toBe("Priority");
    setWidgetTags(board, "a", [tag.id, "missing"]);
    expect(board.widgets.get("a")!.tagIds).toEqual([tag.id]);
    expect(widgetsWithTag(board, tag.id)).toEqual(["a"]);

    expect(renameTag(board, tag.id, "High")).toBe(true);
    expect(board.tags.get(tag.id)!.name).toBe("High");
    expect(board.widgets.get("a")!.tagIds).toEqual([tag.id]);

    deleteTag(board, tag.id);
    expect(board.tags.has(tag.id)).toBe(false);
    expect(board.widgets.get("a")!.tagIds).toBeUndefined();
  });

  it("toggles a tag and refuses duplicates and over-limit boards", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    const tag = createTag(board, "One", "green")!;
    toggleWidgetTag(board, "a", tag.id);
    expect(board.widgets.get("a")!.tagIds).toEqual([tag.id]);
    toggleWidgetTag(board, "a", tag.id);
    expect(board.widgets.get("a")!.tagIds).toBeUndefined();

    expect(createTag(board, " one ", "red")).toBeNull();
    for (let i = 0; i < 50; i += 1) createTag(board, `Tag ${i}`, "gray");
    expect(createTag(board, "Too many", "gray")).toBeNull();
  });
});

describe("tags on a locked object", () => {
  it("refuses to change the vocabulary of a locked object", () => {
    const board = new BoardDocument();
    createSticky(board, "a", { x: 0, y: 0 });
    const tag = createTag(board, "Locked", "red")!;
    setLocked(board, ["a"], true);

    setWidgetTags(board, "a", [tag.id]);
    toggleWidgetTag(board, "a", tag.id);
    expect(board.widgets.get("a")!.tagIds).toBeUndefined();
  });
});
