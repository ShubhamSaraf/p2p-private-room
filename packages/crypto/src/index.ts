import { ristretto255 } from "@cipherman/pake-js/cpace";

const encoder = new TextEncoder();
const CPACE_MAC_LABEL = encoder.encode("CPaceMac");
const INITIATOR_AD = encoder.encode("peerlink/auth/v1/initiator");
const RESPONDER_AD = encoder.encode("peerlink/auth/v1/responder");

export const PAKE_SUITE = ristretto255.SUITE_NAME;
export const PAKE_SESSION_ID_BYTES = 32;
export const PAKE_SHARE_BYTES = 32;
export const PAKE_CONFIRMATION_BYTES = 64;
export const SHARED_SECRET_MIN_LENGTH = 6;
export const SHARED_SECRET_MAX_LENGTH = 128;

export type PakeRole = "initiator" | "responder";

export type PakeState = {
  role: PakeRole;
  sid: Uint8Array;
  ephemeralSecret: Uint8Array;
  ownShare: Uint8Array;
};

export type PakeResult = {
  sessionKey: Uint8Array;
  ownConfirmation: Uint8Array;
  confirmationKey: CryptoKey;
  peerConfirmationData: Uint8Array;
};

export function validateSharedSecret(secret: string): string | null {
  const normalized = normalizeSharedSecret(secret);
  if (normalized.length < SHARED_SECRET_MIN_LENGTH) {
    return `Use at least ${SHARED_SECRET_MIN_LENGTH} characters.`;
  }
  if (normalized.length > SHARED_SECRET_MAX_LENGTH) {
    return `Use at most ${SHARED_SECRET_MAX_LENGTH} characters.`;
  }
  return null;
}

export function startPake(options: {
  secret: string;
  sid: Uint8Array;
  channelId: Uint8Array;
  role: PakeRole;
}): PakeState {
  const validationError = validateSharedSecret(options.secret);
  if (validationError) throw new Error(validationError);
  if (options.sid.length !== PAKE_SESSION_ID_BYTES) {
    throw new Error(`CPace session IDs must be ${PAKE_SESSION_ID_BYTES} bytes.`);
  }
  if (options.channelId.length === 0) throw new Error("CPace channel binding is required.");

  const passwordBytes = encoder.encode(normalizeSharedSecret(options.secret));
  try {
    const exchange = ristretto255.init({
      PRS: passwordBytes,
      sid: options.sid,
      CI: options.channelId,
    });
    return {
      role: options.role,
      sid: options.sid.slice(),
      ephemeralSecret: exchange.ephemeralSecret,
      ownShare: exchange.share,
    };
  } finally {
    passwordBytes.fill(0);
  }
}

export async function finishPake(options: {
  state: PakeState;
  peerShare: Uint8Array;
}): Promise<PakeResult> {
  if (options.peerShare.length !== PAKE_SHARE_BYTES) {
    throw new Error(`CPace peer shares must be ${PAKE_SHARE_BYTES} bytes.`);
  }

  const ownAD = associatedData(options.state.role);
  const peerAD = associatedData(otherRole(options.state.role));
  const sessionKey = ristretto255.deriveIskInitiatorResponder({
    ephemeralSecret: options.state.ephemeralSecret,
    ownShare: options.state.ownShare,
    peerShare: options.peerShare,
    ownAD,
    peerAD,
    sid: options.state.sid,
    role: options.state.role,
  });

  const confirmationKeyBytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-512",
      toArrayBuffer(concatBytes(CPACE_MAC_LABEL, options.state.sid, sessionKey)),
    ),
  );
  const confirmationKey = await crypto.subtle.importKey(
    "raw",
    confirmationKeyBytes,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign", "verify"],
  );
  confirmationKeyBytes.fill(0);

  const ownConfirmationData = lengthValue(options.state.ownShare, ownAD);
  const peerConfirmationData = lengthValue(options.peerShare, peerAD);
  const ownConfirmation = new Uint8Array(
    await crypto.subtle.sign("HMAC", confirmationKey, toArrayBuffer(ownConfirmationData)),
  );

  return { sessionKey, ownConfirmation, confirmationKey, peerConfirmationData };
}

export async function verifyPakeConfirmation(
  result: PakeResult,
  peerConfirmation: Uint8Array,
): Promise<boolean> {
  if (peerConfirmation.length !== PAKE_CONFIRMATION_BYTES) return false;
  return crypto.subtle.verify(
    "HMAC",
    result.confirmationKey,
    toArrayBuffer(peerConfirmation),
    toArrayBuffer(result.peerConfirmationData),
  );
}

export function destroyPakeState(state: PakeState | null): void {
  if (!state) return;
  state.ephemeralSecret.fill(0);
  state.sid.fill(0);
}

export function destroyPakeResult(result: PakeResult | null): void {
  if (!result) return;
  result.sessionKey.fill(0);
  result.ownConfirmation.fill(0);
  result.peerConfirmationData.fill(0);
}

function normalizeSharedSecret(secret: string): string {
  return secret.normalize("NFKC").trim();
}

function associatedData(role: PakeRole): Uint8Array {
  return role === "initiator" ? INITIATOR_AD : RESPONDER_AD;
}

function otherRole(role: PakeRole): PakeRole {
  return role === "initiator" ? "responder" : "initiator";
}

function lengthValue(...values: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const value of values) parts.push(leb128(value.length), value);
  return concatBytes(...parts);
}

function leb128(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(bytes);
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return new Uint8Array(value).buffer;
}
