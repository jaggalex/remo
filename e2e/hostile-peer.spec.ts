import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { freshBoard, openBoard, waitForBoardEditor } from "./helpers";

/**
 * A peer that writes junk into the shared document (ADR-171).
 *
 * Yjs validates nothing, so any editor's client — an old build, a bug, a script with the
 * editor's cookie — can put any value into the room. The scenario plays that peer from
 * Node over the same socket the app uses, then checks what everyone else in the room
 * would see: the room opens, the healthy object is intact, the junk is repaired or shown
 * as a placeholder, a planted `javascript:` link is gone, and nothing throws.
 *
 * Before ADR-171 this room was a blank page for every member (`e.get is not a function`).
 */

type YModule = typeof import("yjs");

/**
 * The sync service's own Yjs, ws and y-websocket: the root workspace does not depend on
 * them, and one copy of Yjs per process is what y-websocket requires.
 */
function syncModules(): {
  Y: YModule;
  WebsocketProvider: new (url: string, room: string, doc: unknown, options: unknown) => {
    on(event: string, cb: (value: unknown) => void): void;
    destroy(): void;
  };
  WebSocket: new (url: string, options: unknown) => unknown;
} {
  const require = createRequire(join(test.info().project.testDir, "..", "apps", "sync", "package.json"));
  return {
    Y: require("yjs") as YModule,
    WebsocketProvider: require("y-websocket").WebsocketProvider,
    WebSocket: require("ws"),
  };
}

/** Connect as the signed-in editor of `page`, write junk, wait for the server to have it. */
async function writeAsHostilePeer(page: Page, boardId: string): Promise<void> {
  const { Y, WebsocketProvider, WebSocket } = syncModules();
  // freshBoard left the page on the app, so its address is the harness's web origin.
  const base = new URL(page.url());
  const cookie = (await page.context().cookies(base.origin))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  // The upgrade checks Origin and reads the session cookie, exactly as for the browser.
  class AuthenticatedSocket extends (WebSocket as unknown as new (url: string, options: unknown) => object) {
    constructor(url: string) {
      super(url, { headers: { Cookie: cookie, Origin: base.origin } });
    }
  }

  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/sync`,
    boardId,
    doc,
    { WebSocketPolyfill: AuthenticatedSocket, disableBc: true },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hostile peer never synced")), 15_000);
    provider.on("sync", (synced) => {
      if (!synced) return;
      clearTimeout(timer);
      resolve();
    });
  });

  doc.transact(() => {
    const widgets = doc.getMap<unknown>("widgets");
    widgets.set("survivor", {
      id: "survivor",
      type: "sticky_note",
      parentId: null,
      x: 4000,
      y: 4000,
      width: 200,
      height: 200,
    });
    const text = new Y.Text();
    text.insert(0, "I survived");
    doc.getMap<unknown>("texts").set("survivor", text);

    widgets.set("junk-string", "not a widget");
    widgets.set("junk-rocket", {
      type: "rocket",
      x: "far",
      width: "wide",
      style: ["red"],
      link: { kind: "url", url: "javascript:alert(document.cookie)" },
    });
    widgets.set("junk-note", {
      id: "junk-note",
      type: "sticky_note",
      parentId: 5,
      x: 4300,
      y: 4000,
      width: 200,
      height: 200,
      style: { fontSize: "huge", fillColor: 7 },
      runs: "bold",
      tagIds: "t1",
      link: { kind: "url", url: "javascript:alert(1)" },
    });
    doc.getMap<unknown>("texts").set("junk-note", "a string, not Y.Text");
    doc.getMap<unknown>("kanbans").set("junk-kanban", { columns: "nope" });
    doc.getMap<unknown>("tags").set("junk-tag", 5);
    doc.getArray<unknown>("presentation").push([7]);
  });

  // The server acknowledges nothing to a plain peer; wait until it echoes the state back.
  await expect
    .poll(async () => {
      const probe = new Y.Doc();
      const reader = new WebsocketProvider(
        `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/sync`,
        boardId,
        probe,
        { WebSocketPolyfill: AuthenticatedSocket, disableBc: true },
      );
      const has = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 5_000);
        reader.on("sync", (synced) => {
          if (!synced) return;
          clearTimeout(timer);
          resolve(probe.getMap("widgets").has("survivor"));
        });
      });
      reader.destroy();
      return has;
    })
    .toBe(true);
  provider.destroy();
}

test("a room survives junk written by another client", async ({ page }) => {
  const account = await freshBoard(page, "hostile-peer");
  await writeAsHostilePeer(page, account.boardId);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openBoard(page, account.boardId);
  await waitForBoardEditor(page);

  // No blank page and no room-level fallback.
  await expect(page.getByText("This screen could not be shown")).toHaveCount(0);
  await expect(page.locator("canvas").first()).toBeVisible();

  type ProbeWidget = { id: string; type: string; text: string; x: number };
  const widgets = await page.evaluate(
    () => (window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets,
  );
  const byId = new Map(widgets.map((w) => [w.id, w]));

  expect(byId.get("survivor")?.text).toBe("I survived");
  expect(byId.has("junk-string")).toBe(false);
  expect(byId.get("junk-rocket")).toMatchObject({ type: "unsupported", x: 0 });
  expect(byId.get("junk-note")?.type).toBe("sticky_note");

  // The planted `javascript:` links are dropped on read (unit-tested in sanitize.test.ts);
  // here it is enough that the object carrying one renders like any other note.
  expect(errors).toEqual([]);
});
