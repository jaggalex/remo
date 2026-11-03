import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeSocket } from "./sync-connections.mjs";

afterEach(() => vi.useRealTimers());

describe("revoking a socket", () => {
  it("sends the close frame, then cuts a client that ignores it", () => {
    vi.useFakeTimers();
    const socket = { readyState: 1, close: vi.fn(), terminate: vi.fn() };

    revokeSocket(socket, 4403, "access changed");
    expect(socket.close).toHaveBeenCalledWith(4403, "access changed");
    expect(socket.terminate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(socket.terminate).toHaveBeenCalled();
  });

  it("does nothing to a socket that is already closing", () => {
    const socket = { readyState: 2, close: vi.fn(), terminate: vi.fn() };
    revokeSocket(socket, 4403, "access changed");
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
  });
});
