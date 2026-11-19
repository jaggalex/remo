import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { threadInFrame } from "./commentScope";
import type { CommentThread } from "./commentsApi";

const frame: Widget = {
  id: "f1",
  type: "frame",
  parentId: null,
  x: 0,
  y: 0,
  width: 400,
  height: 300,
};
const note: Widget = {
  id: "n1",
  type: "sticky_note",
  parentId: "f1",
  x: 100,
  y: 100,
  width: 100,
  height: 100,
};
const outside: Widget = {
  id: "n2",
  type: "sticky_note",
  parentId: null,
  x: 900,
  y: 900,
  width: 100,
  height: 100,
};
const thread = (anchor: CommentThread["anchor"]): CommentThread => ({
  id: "t1",
  boardId: "b1",
  anchor,
  resolvedAt: null,
  resolvedBy: null,
  createdBy: "u1",
  createdByName: "Ann",
  createdAt: "",
  updatedAt: "",
  unread: 0,
  comments: [],
});

describe("comments on a slide", () => {
  it("keeps a widget anchor inside the frame by parent chain", () => {
    expect(threadInFrame(thread({ kind: "widget", widgetId: "n1" }), "f1", [frame, note])).toBe(true);
    expect(threadInFrame(thread({ kind: "widget", widgetId: "n2" }), "f1", [frame, note, outside])).toBe(false);
  });

  it("keeps a point anchor by geometry", () => {
    expect(threadInFrame(thread({ kind: "point", x: 10, y: 10 }), "f1", [frame])).toBe(true);
    expect(threadInFrame(thread({ kind: "point", x: 900, y: 900 }), "f1", [frame])).toBe(false);
  });

  it("shows every thread when nothing is presented", () => {
    expect(threadInFrame(thread({ kind: "point", x: 900, y: 900 }), null, [frame])).toBe(true);
  });
});
