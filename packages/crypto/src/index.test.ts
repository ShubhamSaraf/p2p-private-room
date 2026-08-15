import { describe, expect, it } from "vitest";

import {
  PAKE_CONFIRMATION_BYTES,
  PAKE_SESSION_ID_BYTES,
  destroyPakeResult,
  destroyPakeState,
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

  it("validates shared-secret length without retaining it", () => {
    expect(validateSharedSecret("short")).toBe("Use at least 6 characters.");
    expect(validateSharedSecret("sixsix")).toBeNull();
  });
});
