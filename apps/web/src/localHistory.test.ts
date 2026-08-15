import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLocalHistory,
  getLocalHistoryEnabled,
  loadRoomMessages,
  saveRoomMessages,
  setLocalHistoryEnabled,
} from "./localHistory";

beforeEach(async () => {
  await clearLocalHistory();
  await setLocalHistoryEnabled(false);
});

describe("device-local chat history", () => {
  it("defaults off and persists only the opt-in preference", async () => {
    expect(await getLocalHistoryEnabled()).toBe(false);
    await setLocalHistoryEnabled(true);
    expect(await getLocalHistoryEnabled()).toBe(true);
  });

  it("stores messages by room and clears them on request", async () => {
    await saveRoomMessages("room-a", [
      { type: "chat", id: "message-1", timestamp: 2, text: "local only", direction: "outgoing" },
    ]);
    await saveRoomMessages("room-b", [
      { type: "chat", id: "message-2", timestamp: 1, text: "separate", direction: "incoming" },
    ]);
    expect((await loadRoomMessages("room-a")).map((message) => message.text)).toEqual([
      "local only",
    ]);
    await clearLocalHistory();
    expect(await loadRoomMessages("room-a")).toEqual([]);
  });
});
