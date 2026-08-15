export const PRODUCT_NAME = "PeerLink" as const;
export const SIGNALING_PROTOCOL_VERSION = 1 as const;
export const ROOM_ID_LENGTH = 32 as const;

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

export function isRoomId(value: string): boolean {
  return value.length === ROOM_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
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
