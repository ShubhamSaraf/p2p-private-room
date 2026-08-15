export const PRODUCT_NAME = "PeerLink" as const;
export const SIGNALING_PROTOCOL_VERSION = 1 as const;

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
};

export type SignalingMessage =
  | { type: "peer-ready"; role: PeerRole }
  | SessionDescriptionMessage
  | IceCandidateMessage
  | { type: "peer-left" }
  | { type: "error"; code: string; message: string };

export type ServiceHealth = {
  status: "ok";
  service: "signaling";
  product: typeof PRODUCT_NAME;
  protocolVersion: typeof SIGNALING_PROTOCOL_VERSION;
};
