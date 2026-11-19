import { afterEach, describe, expect, it, vi } from "vitest";
import { guestIdentity, loadIdentity, saveIdentity } from "./identity";

/** The smallest localStorage a browser-facing module needs; vitest runs in node here. */
function stubBrowser({ search = "", stored }: { search?: string; stored?: unknown } = {}) {
  const values = new Map<string, string>();
  if (stored !== undefined) values.set("remo.identity", JSON.stringify(stored));
  const window = {
    location: { search },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
  vi.stubGlobal("window", window);
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identity", () => {
  it("keeps a stored guest name for the signed-out browser", () => {
    stubBrowser({ stored: { name: "Bo", color: "#2d9bf0" } });
    expect(loadIdentity()).toMatchObject({
      name: "Bo",
      guestName: "Bo",
      override: false,
    });
  });

  it("treats ?user= as an explicit per-tab name and remembers the guest name", () => {
    stubBrowser({ search: "?user=Tester", stored: { name: "Bo", color: "#2d9bf0" } });
    expect(loadIdentity()).toMatchObject({
      name: "Tester",
      guestName: "Bo",
      override: true,
    });
  });

  it("generates a guest on a fresh browser and persists it", () => {
    const values = stubBrowser();
    const identity = loadIdentity();
    expect(identity.name).toMatch(/^Guest [0-9a-f]{4}$/);
    expect(identity.guestName).toBe(identity.name);
    expect(identity.override).toBe(false);
    expect(JSON.parse(values.get("remo.identity")!)).toMatchObject({ name: identity.name });
  });

  it("returns to the guest name and drops the test override", () => {
    expect(
      guestIdentity({
        name: "Tester",
        guestName: "Bo",
        color: "#2d9bf0",
        override: true,
      }),
    ).toMatchObject({ name: "Bo", guestName: "Bo", override: false });
  });

  it("stores the guest name with the choice", () => {
    const values = stubBrowser();
    saveIdentity({ name: "Bo", guestName: "Bo", color: "#2d9bf0" });
    expect(JSON.parse(values.get("remo.identity")!)).toEqual({
      name: "Bo",
      guestName: "Bo",
      color: "#2d9bf0",
    });
  });
});
