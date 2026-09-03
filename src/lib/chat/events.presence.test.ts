import { describe, expect, it, vi } from "vitest";
import { publishPresence, publishTyping, roomSignals, subscribeRoom } from "./events";

describe("ephemeral room signals", () => {
  it("publishes presence and typing without storing message content", () => {
    const listener = vi.fn();
    const stop = subscribeRoom("room-presence-test", listener);
    publishPresence("room-presence-test", "user-1", "小明", true);
    publishTyping("room-presence-test", "user-1", "小明");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "presence", userId: "user-1", displayName: "小明" }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "typing", userId: "user-1" }));
    expect(JSON.stringify(roomSignals("room-presence-test"))).not.toContain("body");
    stop();
  });

  it("expires typing quickly", () => {
    vi.useFakeTimers();
    publishTyping("room-expire-test", "user-1", "小明");
    vi.advanceTimersByTime(5_000);
    expect(roomSignals("room-expire-test").typing).toHaveLength(0);
    vi.useRealTimers();
  });
});
