import { describe, expect, it } from "vitest";

import {
  PRODUCT_NAME,
  SIGNALING_PROTOCOL_VERSION,
  isClientSignalingMessage,
  isRoomId,
  isServerSignalingMessage,
} from "./index";

describe("shared protocol", () => {
  it("exposes stable service metadata", () => {
    expect(PRODUCT_NAME).toBe("PeerLink");
    expect(SIGNALING_PROTOCOL_VERSION).toBe(1);
  });

  it("accepts only 32-character URL-safe room IDs", () => {
    expect(isRoomId("A7_k92LmPq4VX8nBz0RtUvWxY1234567")).toBe(true);
    expect(isRoomId("short-room")).toBe(false);
    expect(isRoomId("A7/k92LmPq4VX8nBz0RtUvWxY1234567")).toBe(false);
  });

  it("validates SDP and ICE messages", () => {
    expect(isClientSignalingMessage({ type: "offer", sdp: "v=0" })).toBe(true);
    expect(
      isClientSignalingMessage({
        type: "ice-candidate",
        candidate: "candidate:1 1 UDP 1 127.0.0.1 9999 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      }),
    ).toBe(true);
    expect(isClientSignalingMessage({ type: "chat", text: "not yet" })).toBe(false);
  });

  it("validates server lifecycle messages", () => {
    expect(isServerSignalingMessage({ type: "room-joined", role: "initiator", peerCount: 1 })).toBe(
      true,
    );
    expect(isServerSignalingMessage({ type: "room-joined", role: "owner", peerCount: 3 })).toBe(
      false,
    );
  });
});
