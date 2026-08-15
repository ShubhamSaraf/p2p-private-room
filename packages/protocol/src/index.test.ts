import { describe, expect, it } from "vitest";

import {
  AUTH_PROTOCOL_VERSION,
  CHAT_MESSAGE_MAX_LENGTH,
  ENCRYPTION_PROTOCOL_VERSION,
  PRODUCT_NAME,
  SIGNALING_PROTOCOL_VERSION,
  isChatMessage,
  isAuthenticationMessage,
  isControlMessage,
  isEncryptedControlMessage,
  isApplicationMessage,
  isTransferControlMessage,
  isClientSignalingMessage,
  isRoomId,
  isServerSignalingMessage,
  isTurnCredentials,
} from "./index";

describe("shared protocol", () => {
  it("exposes stable service metadata", () => {
    expect(PRODUCT_NAME).toBe("PeerLink");
    expect(SIGNALING_PROTOCOL_VERSION).toBe(1);
    expect(AUTH_PROTOCOL_VERSION).toBe(1);
  });

  it("validates PAKE control frames without accepting them as signaling", () => {
    const share = {
      type: "pake-share",
      version: AUTH_PROTOCOL_VERSION,
      sessionId: "A".repeat(43),
      share: "b".repeat(43),
    };
    const confirmation = {
      type: "pake-confirm",
      version: AUTH_PROTOCOL_VERSION,
      confirmation: "C".repeat(86),
    };

    expect(isAuthenticationMessage(share)).toBe(true);
    expect(isAuthenticationMessage(confirmation)).toBe(true);
    expect(isControlMessage(share)).toBe(true);
    expect(isClientSignalingMessage(share)).toBe(false);
    expect(isAuthenticationMessage({ ...share, sessionId: "too-short" })).toBe(false);
    expect(isAuthenticationMessage({ ...confirmation, confirmation: "+".repeat(86) })).toBe(false);
  });

  it("accepts only 32-character URL-safe room IDs", () => {
    expect(isRoomId("A7_k92LmPq4VX8nBz0RtUvWxY1234567")).toBe(true);
    expect(isRoomId("short-room")).toBe(false);
    expect(isRoomId("A7/k92LmPq4VX8nBz0RtUvWxY1234567")).toBe(false);
  });

  it("accepts encrypted envelopes and excludes plaintext chat from control frames", () => {
    const encrypted = {
      type: "encrypted",
      version: ENCRYPTION_PROTOCOL_VERSION,
      counter: "0",
      ciphertext: "A".repeat(22),
    };
    const chat = {
      type: "chat",
      id: "9f23ce7e-1821-4b74-b60a-0d8185631d99",
      timestamp: 1_723_456_789_000,
      text: "plaintext",
    };

    expect(isEncryptedControlMessage(encrypted)).toBe(true);
    expect(isControlMessage(encrypted)).toBe(true);
    expect(isControlMessage(chat)).toBe(false);
    expect(isEncryptedControlMessage({ ...encrypted, counter: "00" })).toBe(false);
    expect(isEncryptedControlMessage({ ...encrypted, ciphertext: "not+url/safe" })).toBe(false);
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

  it("validates bounded chat messages with IDs and timestamps", () => {
    const message = {
      type: "chat",
      id: "9f23ce7e-1821-4b74-b60a-0d8185631d99",
      timestamp: 1_723_456_789_000,
      text: "Hello from PeerLink",
    };

    expect(isChatMessage(message)).toBe(true);
    expect(isChatMessage({ ...message, id: "not-a-uuid" })).toBe(false);
    expect(isChatMessage({ ...message, timestamp: Number.NaN })).toBe(false);
    expect(isChatMessage({ ...message, text: "   " })).toBe(false);
    expect(isChatMessage({ ...message, text: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) })).toBe(
      false,
    );
  });

  it("validates file offers, decisions, and integrity completion", () => {
    const offer = {
      type: "file-offer",
      id: "9f23ce7e-1821-4b74-b60a-0d8185631d99",
      name: "photo.png",
      size: 1024,
      mime: "image/png",
      category: "image",
      lastModified: 1_723_456_789_000,
    };
    expect(isTransferControlMessage(offer)).toBe(true);
    expect(isApplicationMessage(offer)).toBe(true);
    expect(isTransferControlMessage({ ...offer, name: "bad\u0000name" })).toBe(false);
    expect(
      isTransferControlMessage({
        type: "file-complete",
        id: offer.id,
        chunks: 1,
        sha256: "a".repeat(64),
      }),
    ).toBe(true);
  });
});

describe("TURN credentials", () => {
  it("accepts only expiring TURN server credentials", () => {
    expect(
      isTurnCredentials({
        iceServers: [
          {
            urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
            username: "2000000000:browser-id",
            credential: "signed-value",
          },
        ],
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(true);
    expect(isTurnCredentials({ iceServers: [], expiresAt: Date.now() + 60_000 })).toBe(false);
    expect(
      isTurnCredentials({
        iceServers: [{ urls: ["https://example.com"], username: "u", credential: "c" }],
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(false);
  });
});
