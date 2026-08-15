import { describe, expect, it } from "vitest";

import {
  PAKE_CONFIRMATION_BYTES,
  PAKE_SESSION_ID_BYTES,
  destroyPakeResult,
  destroyPakeState,
  deriveApplicationCipher,
  finishPake,
  startPake,
  validateSharedSecret,
  verifyPakeConfirmation,
} from "./index";

const channelId = new TextEncoder().encode("peerlink/room/test-room");

describe("PeerLink CPace authentication", () => {
  it("authenticates two peers with the same shared secret", async () => {
    const sid = crypto.getRandomValues(new Uint8Array(PAKE_SESSION_ID_BYTES));
    const initiator = startPake({ secret: "correct horse", sid, channelId, role: "initiator" });
    const responder = startPake({ secret: "correct horse", sid, channelId, role: "responder" });

    const initiatorResult = await finishPake({ state: initiator, peerShare: responder.ownShare });
    const responderResult = await finishPake({ state: responder, peerShare: initiator.ownShare });

    expect(initiatorResult.sessionKey).toEqual(responderResult.sessionKey);
    expect(initiatorResult.ownConfirmation).toHaveLength(PAKE_CONFIRMATION_BYTES);
    expect(await verifyPakeConfirmation(initiatorResult, responderResult.ownConfirmation)).toBe(
      true,
    );
    expect(await verifyPakeConfirmation(responderResult, initiatorResult.ownConfirmation)).toBe(
      true,
    );

    destroyPakeState(initiator);
    destroyPakeState(responder);
    destroyPakeResult(initiatorResult);
    destroyPakeResult(responderResult);
  });

  it("rejects confirmation when the shared secrets differ", async () => {
    const sid = crypto.getRandomValues(new Uint8Array(PAKE_SESSION_ID_BYTES));
    const initiator = startPake({ secret: "first secret", sid, channelId, role: "initiator" });
    const responder = startPake({ secret: "second secret", sid, channelId, role: "responder" });

    const initiatorResult = await finishPake({ state: initiator, peerShare: responder.ownShare });
    const responderResult = await finishPake({ state: responder, peerShare: initiator.ownShare });

    expect(await verifyPakeConfirmation(initiatorResult, responderResult.ownConfirmation)).toBe(
      false,
    );
    expect(await verifyPakeConfirmation(responderResult, initiatorResult.ownConfirmation)).toBe(
      false,
    );

    destroyPakeState(initiator);
    destroyPakeState(responder);
    destroyPakeResult(initiatorResult);
    destroyPakeResult(responderResult);
  });

  it("performs key confirmation without secure-context WebCrypto", async () => {
    const sid = crypto.getRandomValues(new Uint8Array(PAKE_SESSION_ID_BYTES));
    const initiator = startPake({ secret: "same secret", sid, channelId, role: "initiator" });
    const responder = startPake({ secret: "same secret", sid, channelId, role: "responder" });
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

    try {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
      const initiatorResult = await finishPake({ state: initiator, peerShare: responder.ownShare });
      const responderResult = await finishPake({ state: responder, peerShare: initiator.ownShare });
      expect(await verifyPakeConfirmation(initiatorResult, responderResult.ownConfirmation)).toBe(
        true,
      );
      destroyPakeResult(initiatorResult);
      destroyPakeResult(responderResult);
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      destroyPakeState(initiator);
      destroyPakeState(responder);
    }
  });

  it("validates shared-secret length without retaining it", () => {
    expect(validateSharedSecret("short")).toBe("Use at least 6 characters.");
    expect(validateSharedSecret("sixsix")).toBeNull();
  });
});

describe("PeerLink application encryption", () => {
  it("derives directional keys and exchanges encrypted messages", () => {
    const sessionKey = crypto.getRandomValues(new Uint8Array(64));
    const initiator = deriveApplicationCipher({ sessionKey, channelId, role: "initiator" });
    const responder = deriveApplicationCipher({ sessionKey, channelId, role: "responder" });
    const plaintext = new TextEncoder().encode("not visible on the DataChannel");

    const first = initiator.encrypt(plaintext);
    expect(new TextDecoder().decode(first.ciphertext)).not.toContain("not visible");
    expect(responder.decrypt(first)).toEqual(plaintext);

    const reply = responder.encrypt(new TextEncoder().encode("encrypted reply"));
    expect(new TextDecoder().decode(initiator.decrypt(reply))).toBe("encrypted reply");

    initiator.destroy();
    responder.destroy();
    sessionKey.fill(0);
  });

  it("rejects tampering and replayed counters", () => {
    const sessionKey = crypto.getRandomValues(new Uint8Array(64));
    const initiator = deriveApplicationCipher({ sessionKey, channelId, role: "initiator" });
    const responder = deriveApplicationCipher({ sessionKey, channelId, role: "responder" });
    const payload = initiator.encrypt(new TextEncoder().encode("authenticated"));
    const tampered = { ...payload, ciphertext: payload.ciphertext.slice() };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;

    expect(() => responder.decrypt(tampered)).toThrow();
    expect(responder.decrypt(payload)).toEqual(new TextEncoder().encode("authenticated"));
    expect(() => responder.decrypt(payload)).toThrow(/repeated/);

    initiator.destroy();
    responder.destroy();
    sessionKey.fill(0);
  });
});
