import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_ERROR_LIMIT,
  clearClientErrors,
  clientErrorMessage,
  installClientErrors,
  recentClientErrors,
  recordClientError,
  type ErrorTarget,
} from "./clientErrorBuffer";

/** A window-shaped object: vitest runs in node, and the buffer never touches a real one. */
function fakeWindow() {
  const handlers = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const target: ErrorTarget & { emit: (type: string, event: unknown) => void } = {
    addEventListener(type, listener) {
      const set = handlers.get(type) ?? new Set();
      set.add(listener);
      handlers.set(type, set);
    },
    removeEventListener(type, listener) {
      handlers.get(type)?.delete(listener);
    },
    emit(type, event) {
      for (const listener of handlers.get(type) ?? []) {
        if (typeof listener === "function") listener(event as Event);
      }
    },
  };
  return target;
}

afterEach(() => {
  clearClientErrors();
});

describe("client error buffer", () => {
  it("keeps the last twenty errors, newest last", () => {
    for (let index = 0; index < 25; index += 1) {
      recordClientError(`failure ${index}`, index);
    }
    const kept = recentClientErrors();
    expect(kept).toHaveLength(CLIENT_ERROR_LIMIT);
    expect(kept[0]).toEqual({ message: "failure 5", at: 5 });
    expect(kept.at(-1)).toEqual({ message: "failure 24", at: 24 });
  });

  it("sends a message and a time, never the object an error carried", () => {
    recordClientError(new Error("render failed"), 7);
    recordClientError({ message: "request failed", room: "secret room title" }, 8);
    recordClientError({ room: "secret room title" }, 9);
    recordClientError("plain text", 10);

    const wire = JSON.stringify(recentClientErrors());
    expect(wire).not.toContain("secret room title");
    expect(recentClientErrors().map((entry) => entry.message)).toEqual([
      "render failed",
      "request failed",
      "unknown error",
      "plain text",
    ]);
  });

  it("flattens whitespace and bounds the length", () => {
    expect(clientErrorMessage("line one\n\tline two  ")).toBe("line one line two");
    expect(clientErrorMessage("   ")).toBe("unknown error");
    const long = clientErrorMessage("x".repeat(1000));
    expect(long.length).toBe(300);
    expect(long.endsWith("…")).toBe(true);
  });

  it("installs one pair of global handlers and records both shapes", () => {
    const window = fakeWindow();
    const remove = installClientErrors(window);
    // A second install would double every record; the buffer refuses it.
    installClientErrors(window);

    window.emit("error", { error: new Error("handler threw") });
    window.emit("error", { message: "Script error." });
    window.emit("unhandledrejection", { reason: "nobody awaited this" });

    expect(recentClientErrors().map((entry) => entry.message)).toEqual([
      "handler threw",
      "Script error.",
      "nobody awaited this",
    ]);

    remove();
    window.emit("error", { error: new Error("after removal") });
    expect(recentClientErrors()).toHaveLength(3);
  });
});
