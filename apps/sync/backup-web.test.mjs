import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { buildBoardBackup } from "./backup.mjs";
import {
  BackupError,
  backupToBoard,
  sha256Hex,
  verifyBoardBackup,
} from "../web/src/backupFormat";

function state() {
  const doc = new Y.Doc();
  const widgets = doc.getMap("widgets");
  const note = new Y.Map();
  note.set("id", "note-1");
  note.set("type", "sticky_note");
  note.set("x", 10);
  note.set("y", 20);
  note.set("width", 120);
  note.set("height", 90);
  widgets.set("note-1", note);
  const texts = doc.getMap("texts");
  const text = new Y.Text();
  text.insert(0, "hello");
  texts.set("note-1", text);
  doc.getMap("groupNames").set("grp-1", "Cluster");
  doc.getMap("tags").set("tag-1", { id: "tag-1", name: "Priority", color: "blue" });
  doc.getArray("presentation").push(["frame-1"]);
  const encoded = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return encoded;
}

describe("board backup import (ADR-071)", () => {
  it("matches the SHA-256 test vectors", () => {
    const encoder = new TextEncoder();
    expect(sha256Hex(encoder.encode(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex(
        encoder.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      ),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("accepts a backup the server wrote and keeps text", async () => {
    const server = buildBoardBackup({
      state: state(),
      boardId: "board-1",
      title: "Backup test",
    });
    const bundle = await verifyBoardBackup(JSON.parse(JSON.stringify(server)));
    const restored = backupToBoard(bundle);
    expect(restored.board.title).toBe("Backup test");
    expect(restored.board.widgets).toHaveLength(1);
    expect(restored.textDeltas["note-1"]).toEqual([{ insert: "hello" }]);
    expect(restored.groupNames["grp-1"]).toBe("Cluster");
    expect(restored.board.groupNames?.["grp-1"]).toBe("Cluster");
    expect(restored.tags["tag-1"]).toMatchObject({ name: "Priority", color: "blue" });
    expect(restored.presentation).toEqual(["frame-1"]);
  });

  it("refuses another format and a changed file", async () => {
    await expect(verifyBoardBackup({ format: "miro" })).rejects.toBeInstanceOf(BackupError);
    const server = buildBoardBackup({ state: state(), boardId: "board-1" });
    const changed = structuredClone(server);
    changed.widgets["note-1"].x = 999;
    await expect(verifyBoardBackup(changed)).rejects.toMatchObject({ code: "CHECKSUM" });
  });

  it("refuses a bundle whose data was removed", async () => {
    const server = buildBoardBackup({ state: state(), boardId: "board-1" });
    const broken = structuredClone(server);
    delete broken.widgets;
    // The checksum covers the missing key too, so tampering is caught first.
    await expect(verifyBoardBackup(broken)).rejects.toMatchObject({ code: "CHECKSUM" });
  });

  it("refuses a widget without an id after verification", () => {
    expect(() =>
      backupToBoard({
        board: { id: "board-1", title: "x" },
        widgets: { bad: { type: "sticky_note" } },
        kanbans: {},
        textDeltas: {},
      }),
    ).toThrow(BackupError);
  });
});
