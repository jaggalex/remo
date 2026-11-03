import { describe, expect, it } from "vitest";
import type { Presence } from "@remo/doc";
import {
  autoFollow,
  followerCount,
  followReducer,
  NO_FOLLOW,
  pendingInvite,
  remoteCamera,
} from "./follow";

const peer = (name: string, over: Partial<Presence> = {}): Presence => ({
  clientId: 1,
  sessionKey: over.sessionKey ?? name,
  accountId: null,
  name,
  label: over.label ?? name,
  joinedAt: 0,
  color: "#000",
  cursor: null,
  self: false,
  camera: null,
  followTo: null,
  stopFollowersAt: null,
  invite: null,
  presenting: null,
  reaction: null,
  ...over,
});

describe("follow state (ADR-076, ADR-151)", () => {
  it("follows a session and clears on unfollow", () => {
    const state = followReducer(NO_FOLLOW, {
      type: "follow",
      target: "session-a",
      label: "Alex",
    });
    expect(state).toEqual({ target: "session-a", targetLabel: "Alex", paused: false });
    expect(followReducer(state, { type: "unfollow" })).toEqual(NO_FOLLOW);
  });

  it("pauses on a local pan and resumes without losing the target", () => {
    const state = followReducer(
      { target: "session-a", targetLabel: "Alex", paused: false },
      { type: "localMove" },
    );
    expect(state).toEqual({ target: "session-a", targetLabel: "Alex", paused: true });
    expect(followReducer(state, { type: "resume" })).toEqual({
      target: "session-a",
      targetLabel: "Alex",
      paused: false,
    });
  });

  it("stops from either side: the follower or the followed session", () => {
    expect(
      followReducer(
        { target: "session-a", targetLabel: "Alex", paused: true },
        { type: "stoppedByTarget" },
      ),
    ).toEqual(NO_FOLLOW);
    expect(
      followReducer(
        { target: "session-a", targetLabel: "Alex", paused: false },
        { type: "targetLeft" },
      ),
    ).toEqual(NO_FOLLOW);
  });

  it("mirrors the camera of the exact session, even when two share a name", () => {
    const presence = [
      peer("Alex", {
        sessionKey: "session-a",
        camera: { x: 10, y: 20, zoom: 0.5 },
      }),
      peer("Alex", {
        sessionKey: "session-b",
        label: "Alex (2)",
        camera: { x: -5, y: 7, zoom: 1 },
      }),
    ];
    expect(
      remoteCamera(presence, {
        target: "session-b",
        targetLabel: "Alex (2)",
        paused: false,
      }),
    ).toEqual({ x: -5, y: 7, zoom: 1 });
    expect(
      remoteCamera(presence, {
        target: "session-a",
        targetLabel: "Alex",
        paused: true,
      }),
    ).toBeNull();
    expect(remoteCamera(presence, NO_FOLLOW)).toBeNull();
  });

  it("counts followers per session, not per name", () => {
    const presence = [
      peer("Alex", { sessionKey: "alice", followTo: "bob-1" }),
      peer("Sam", { sessionKey: "sam", followTo: "bob-1" }),
      peer("Bob", { sessionKey: "bob-1", self: true, followTo: "bob-1" }),
      peer("Bob", { sessionKey: "bob-2", label: "Bob (2)", followTo: "bob-1" }),
    ];
    expect(followerCount(presence, "bob-1")).toBe(3);
    expect(followerCount(presence, "bob-2")).toBe(0);
  });

  it("shows a bring-everyone request once, and only while it is fresh", () => {
    const presence = [
      peer("Alex", { invite: { from: "session-a", name: "Alex", at: 5_000 } }),
    ];
    expect(pendingInvite(presence, 0, 6_000)).toEqual({
      from: "session-a",
      name: "Alex",
      at: 5_000,
    });
    expect(pendingInvite(presence, 5_000, 6_000)).toBeNull();
    expect(pendingInvite(presence, 0, 60_000)).toBeNull();
  });

  it("treats only an explicit board setting as automatic", () => {
    expect(autoFollow(true)).toBe(true);
    expect(autoFollow("1")).toBe(true);
    expect(autoFollow("true")).toBe(true);
    expect(autoFollow("")).toBe(false);
    expect(autoFollow(null)).toBe(false);
  });
});
