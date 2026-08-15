import { ristretto255 } from "@cipherman/pake-js/cpace";
import { gcm } from "@noble/ciphers/aes.js";
import { equalBytes } from "@noble/curves/utils";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

const encoder = new TextEncoder();
const CPACE_MAC_LABEL = encoder.encode("CPaceMac");
const INITIATOR_AD = encoder.encode("peerlink/auth/v1/initiator");
const RESPONDER_AD = encoder.encode("peerlink/auth/v1/responder");
const APPLICATION_KEY_INFO = encoder.encode("peerlink/application-encryption/v1");
const APPLICATION_AAD = encoder.encode("peerlink/encrypted-control/v1");
const AES_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const MAX_COUNTER = (1n << 64n) - 1n;

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
  confirmationKey: Uint8Array;
  peerConfirmationData: Uint8Array;
};

export type EncryptedPayload = {
  counter: string;
  ciphertext: Uint8Array;
};

export class ApplicationCipher {
  private sendCounter = 0n;
  private receiveCounter = 0n;
  private destroyed = false;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array,
  ) {
    if (sendKey.length !== AES_KEY_BYTES || receiveKey.length !== AES_KEY_BYTES) {
      throw new Error("Application encryption requires two AES-256 keys.");
    }
  }

  encrypt(plaintext: Uint8Array): EncryptedPayload {
    this.assertUsable();
    if (this.sendCounter > MAX_COUNTER) throw new Error("Application send counter exhausted.");
    const counter = this.sendCounter;
    const nonce = counterNonce(counter);
    const ciphertext = gcm(this.sendKey, nonce, applicationAad(nonce)).encrypt(plaintext);
    this.sendCounter += 1n;
    return { counter: counter.toString(10), ciphertext };
  }

  decrypt(payload: EncryptedPayload): Uint8Array {
    this.assertUsable();
    const counter = parseCounter(payload.counter);
    if (counter !== this.receiveCounter) {
      throw new Error("Encrypted control message is missing, repeated, or out of order.");
    }
    const nonce = counterNonce(counter);
    const plaintext = gcm(this.receiveKey, nonce, applicationAad(nonce)).decrypt(
      payload.ciphertext,
    );
    this.receiveCounter += 1n;
    return plaintext;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.sendKey.fill(0);
    this.receiveKey.fill(0);
    this.destroyed = true;
  }

  private assertUsable(): void {
    if (this.destroyed) throw new Error("Application encryption keys were destroyed.");
  }
}

export function deriveApplicationCipher(options: {
  sessionKey: Uint8Array;
  channelId: Uint8Array;
  role: PakeRole;
}): ApplicationCipher {
  if (options.sessionKey.length < 32) throw new Error("PAKE session key is too short.");
  if (options.channelId.length === 0) throw new Error("Application channel binding is required.");

  const salt = sha256(options.channelId);
  const keyMaterial = hkdf(
    sha256,
    options.sessionKey,
    salt,
    APPLICATION_KEY_INFO,
    AES_KEY_BYTES * 2,
  );
  salt.fill(0);
  const initiatorKey = keyMaterial.slice(0, AES_KEY_BYTES);
  const responderKey = keyMaterial.slice(AES_KEY_BYTES);
  keyMaterial.fill(0);

  return options.role === "initiator"
    ? new ApplicationCipher(initiatorKey, responderKey)
    : new ApplicationCipher(responderKey, initiatorKey);
}

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

  const confirmationKey = sha512(concatBytes(CPACE_MAC_LABEL, options.state.sid, sessionKey));

  const ownConfirmationData = lengthValue(options.state.ownShare, ownAD);
  const peerConfirmationData = lengthValue(options.peerShare, peerAD);
  const ownConfirmation = hmac(sha512, confirmationKey, ownConfirmationData);

  return { sessionKey, ownConfirmation, confirmationKey, peerConfirmationData };
}

export async function verifyPakeConfirmation(
  result: PakeResult,
  peerConfirmation: Uint8Array,
): Promise<boolean> {
  if (peerConfirmation.length !== PAKE_CONFIRMATION_BYTES) return false;
  const expected = hmac(sha512, result.confirmationKey, result.peerConfirmationData);
  const verified = equalBytes(expected, peerConfirmation);
  expected.fill(0);
  return verified;
}

export function destroyPakeState(state: PakeState | null): void {
  if (!state) return;
  state.ephemeralSecret.fill(0);
  state.sid.fill(0);
}

export function destroyPakeResult(result: PakeResult | null): void {
  if (!result) return;
  result.sessionKey.fill(0);
  result.confirmationKey.fill(0);
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

function parseCounter(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error("Invalid encryption counter.");
  const counter = BigInt(value);
  if (counter > MAX_COUNTER) throw new Error("Encryption counter is out of range.");
  return counter;
}

function counterNonce(counter: bigint): Uint8Array {
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(4, counter, false);
  return nonce;
}

function applicationAad(nonce: Uint8Array): Uint8Array {
  return concatBytes(APPLICATION_AAD, nonce);
}
