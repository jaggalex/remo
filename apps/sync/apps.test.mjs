import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_APPS,
  PANEL_NODES,
  firstPartyAppList,
  getFirstPartyApp,
  validateManifest,
} from "./first-party-apps.mjs";

describe("first-party app registry", () => {
  it("declares app.hello with a panel the host can draw", () => {
    const app = getFirstPartyApp("app.hello");
    expect(app).toBeTruthy();
    expect(app.panel.type).toBe("panel");
    expect(app.panel.titleKey).toBe("apps.hello.name");
    expect(app.panel.children.map((node) => node.type)).toEqual(["text", "button"]);
    expect(app.panel.children[1]).toMatchObject({
      labelKey: "apps.hello.say",
      action: "app.hello",
    });
    expect(app.capabilities).toEqual(["board.read"]);
  });

  it("passes its own structural check", () => {
    for (const app of Object.values(FIRST_PARTY_APPS)) {
      expect(validateManifest(app)).toEqual([]);
    }
  });

  it("catches a literal label and an unknown node, so CI fails instead of a browser", () => {
    const app = getFirstPartyApp("app.hello");
    expect(
      validateManifest({
        ...app,
        panel: {
          type: "panel",
          children: [
            { type: "html", value: "<b>hi</b>" },
            { type: "button", label: "Say hello", action: "x" },
          ],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown node html"),
        expect.stringContaining("button without a labelKey"),
      ]),
    );
  });

  it("lists apps for the install screen without their panel", () => {
    expect(firstPartyAppList()).toEqual([
      {
        id: "app.hello",
        version: 1,
        nameKey: "apps.hello.name",
        descriptionKey: "apps.hello.description",
      },
    ]);
    expect(getFirstPartyApp("app.nope")).toBeNull();
  });

  it("returns a text the host can render, not HTML", () => {
    const result = getFirstPartyApp("app.hello").actions["app.hello"].run({
      user: { name: "Ada" },
    });
    expect(result).toEqual({
      message: { key: "apps.hello.greeting", params: { username: "Ada" } },
    });
    expect(JSON.stringify(result)).not.toContain("<");
  });

  it("keeps the node vocabulary closed", () => {
    expect([...PANEL_NODES].sort()).toEqual(["button", "field", "panel", "text"]);
  });
});
