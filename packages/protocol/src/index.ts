export const PRODUCT_NAME = "PeerLink" as const;
export const SIGNALING_PROTOCOL_VERSION = 1 as const;
export const ROOM_ID_LENGTH = 32 as const;
export const CHAT_MESSAGE_MAX_LENGTH = 2_000 as const;
export const AUTH_PROTOCOL_VERSION = 1 as const;
export const ENCRYPTION_PROTOCOL_VERSION = 1 as const;
export const ENCRYPTED_CONTROL_MAX_LENGTH = 87_404 as const;
export const FILE_NAME_MAX_LENGTH = 255 as const;
export const FILE_MIME_MAX_LENGTH = 255 as const;

export type PeerRole = "initiator" | "responder";

export type SessionDescriptionMessage = {
  type: "offer" | "answer";
  sdp: string;
};

export type IceCandidateMessage = {
  type: "ice-candidate";
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

export type ClientSignalingMessage = SessionDescriptionMessage | IceCandidateMessage;

export type ChatMessage = {
  type: "chat";
  id: string;
  timestamp: number;
  text: string;
};

export type FileOfferMessage = {
  type: "file-offer";
  id: string;
  name: string;
  size: number;
  mime: string;
  category: "image" | "file";
  lastModified: number;
};

export type FileDecisionMessage = {
  type: "file-accept" | "file-decline";
  id: string;
};

export type FileCancelMessage = {
  type: "file-cancel";
  id: string;
  reason: string;
};

export type FileCompleteMessage = {
  type: "file-complete";
  id: string;
  chunks: number;
  sha256: string;
};

export type FileVerifiedMessage = {
  type: "file-verified";
  id: string;
  sha256: string;
};

export type TransferControlMessage =
  | FileOfferMessage
  | FileDecisionMessage
  | FileCancelMessage
  | FileCompleteMessage
  | FileVerifiedMessage;

export type ApplicationMessage = ChatMessage | TransferControlMessage;

export type PakeShareMessage = {
  type: "pake-share";
  version: typeof AUTH_PROTOCOL_VERSION;
  sessionId: string;
  share: string;
};

export type PakeConfirmationMessage = {
  type: "pake-confirm";
  version: typeof AUTH_PROTOCOL_VERSION;
  confirmation: string;
};

export type AuthenticationMessage = PakeShareMessage | PakeConfirmationMessage;

export type EncryptedControlMessage = {
  type: "encrypted";
  version: typeof ENCRYPTION_PROTOCOL_VERSION;
  counter: string;
  ciphertext: string;
};

export type ControlMessage = AuthenticationMessage | EncryptedControlMessage;

export type ServerSignalingMessage =
  | { type: "room-joined"; role: PeerRole; peerCount: 1 | 2 }
  | { type: "peer-joined" }
  | ClientSignalingMessage
  | { type: "peer-left" }
  | { type: "error"; code: string; message: string };

export type RoomCreated = {
  roomId: string;
  roomPath: `/r/${string}`;
};

export type ServiceHealth = {
  status: "ok";
  service: "signaling";
  product: typeof PRODUCT_NAME;
  protocolVersion: typeof SIGNALING_PROTOCOL_VERSION;
};

export type TurnCredentials = {
  iceServers: RTCIceServerConfig[];
  expiresAt: number;
};

export type RTCIceServerConfig = {
  urls: string[];
  username: string;
  credential: string;
};

export function isRoomId(value: string): boolean {
  return value.length === ROOM_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isTurnCredentials(value: unknown): value is TurnCredentials {
  if (!isRecord(value) || !Array.isArray(value.iceServers) || value.iceServers.length !== 1) {
    return false;
  }
  if (
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now()
  )
    return false;
  const server = value.iceServers[0];
  return (
    isRecord(server) &&
    Array.isArray(server.urls) &&
    server.urls.length > 0 &&
    server.urls.length <= 4 &&
    server.urls.every((url) => typeof url === "string" && /^turns?:/.test(url)) &&
    typeof server.username === "string" &&
    server.username.length > 0 &&
    server.username.length <= 256 &&
    typeof server.credential === "string" &&
    server.credential.length > 0 &&
    server.credential.length <= 256
  );
}

export function isClientSignalingMessage(value: unknown): value is ClientSignalingMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "offer" || value.type === "answer") {
    return typeof value.sdp === "string" && value.sdp.length > 0 && value.sdp.length <= 65_536;
  }

  if (value.type === "ice-candidate") {
    return (
      typeof value.candidate === "string" &&
      value.candidate.length <= 8_192 &&
      isNullableString(value.sdpMid, 256) &&
      isNullableInteger(value.sdpMLineIndex) &&
      isNullableString(value.usernameFragment, 256)
    );
  }

  return false;
}

export function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    value.type === "chat" &&
    typeof value.id === "string" &&
    isUuid(value.id) &&
    typeof value.timestamp === "number" &&
    Number.isSafeInteger(value.timestamp) &&
    value.timestamp > 0 &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    value.text.length <= CHAT_MESSAGE_MAX_LENGTH
  );
}

export function isTransferControlMessage(value: unknown): value is TransferControlMessage {
  if (!isRecord(value) || typeof value.type !== "string" || !isUuidValue(value.id)) return false;

  if (value.type === "file-offer") {
    return (
      typeof value.name === "string" &&
      value.name.length > 0 &&
      value.name.length <= FILE_NAME_MAX_LENGTH &&
      !hasControlCharacters(value.name) &&
      typeof value.size === "number" &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      typeof value.mime === "string" &&
      value.mime.length <= FILE_MIME_MAX_LENGTH &&
      (value.category === "image" || value.category === "file") &&
      typeof value.lastModified === "number" &&
      Number.isSafeInteger(value.lastModified) &&
      value.lastModified >= 0
    );
  }

  if (value.type === "file-accept" || value.type === "file-decline") return true;
  if (value.type === "file-cancel") {
    return typeof value.reason === "string" && value.reason.length <= 256;
  }
  if (value.type === "file-complete" || value.type === "file-verified") {
    return (
      (value.type === "file-verified" ||
        (typeof value.chunks === "number" &&
          Number.isSafeInteger(value.chunks) &&
          value.chunks >= 0 &&
          value.chunks <= 0xffffffff)) &&
      typeof value.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(value.sha256)
    );
  }
  return false;
}

export function isApplicationMessage(value: unknown): value is ApplicationMessage {
  return isChatMessage(value) || isTransferControlMessage(value);
}

export function isAuthenticationMessage(value: unknown): value is AuthenticationMessage {
  if (!isRecord(value) || value.version !== AUTH_PROTOCOL_VERSION) return false;

  if (value.type === "pake-share") {
    return isBase64Url(value.sessionId, 43) && isBase64Url(value.share, 43);
  }

  if (value.type === "pake-confirm") {
    return isBase64Url(value.confirmation, 86);
  }

  return false;
}

export function isControlMessage(value: unknown): value is ControlMessage {
  return isAuthenticationMessage(value) || isEncryptedControlMessage(value);
}

export function isEncryptedControlMessage(value: unknown): value is EncryptedControlMessage {
  return (
    isRecord(value) &&
    value.type === "encrypted" &&
    value.version === ENCRYPTION_PROTOCOL_VERSION &&
    typeof value.counter === "string" &&
    /^(0|[1-9][0-9]{0,19})$/.test(value.counter) &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length >= 22 &&
    value.ciphertext.length <= ENCRYPTED_CONTROL_MAX_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value.ciphertext)
  );
}

export function isServerSignalingMessage(value: unknown): value is ServerSignalingMessage {
  if (isClientSignalingMessage(value)) return true;
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "room-joined":
      return (
        (value.role === "initiator" || value.role === "responder") &&
        (value.peerCount === 1 || value.peerCount === 2)
      );
    case "peer-joined":
    case "peer-left":
      return true;
    case "error":
      return typeof value.code === "string" && typeof value.message === "string";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUuidValue(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}

function isBase64Url(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[A-Za-z0-9_-]+$/.test(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
