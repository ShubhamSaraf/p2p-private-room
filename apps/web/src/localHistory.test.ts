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
      {
        type: "chat",
        id: "9f23ce7e-1821-4b74-b60a-0d8185631d99",
        timestamp: 2,
        text: "local only",
        direction: "outgoing",
      },
    ]);
    await saveRoomMessages("room-b", [
      {
        type: "chat",
        id: "c4ff781f-b160-44f9-b712-0bb056d8baf2",
        timestamp: 1,
        text: "separate",
        direction: "incoming",
      },
    ]);
    expect((await loadRoomMessages("room-a")).map((message) => message.text)).toEqual([
      "local only",
    ]);
    await clearLocalHistory();
    expect(await loadRoomMessages("room-a")).toEqual([]);
  });
});
