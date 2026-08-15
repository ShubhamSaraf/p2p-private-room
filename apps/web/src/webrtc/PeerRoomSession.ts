import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatMessage,
  type ClientSignalingMessage,
  type IceCandidateMessage,
  type PeerRole,
  type ServerSignalingMessage,
  isChatMessage,
  isServerSignalingMessage,
} from "@peerlink/protocol";

const MAX_VISIBLE_CHAT_MESSAGES = 500;

export type RoomPhase =
  "signaling" | "waiting" | "negotiating" | "connected" | "disconnected" | "error";

export type PeerRoomState = {
  phase: RoomPhase;
  role: PeerRole | null;
  peerConnection: RTCPeerConnectionState;
  dataChannel: RTCDataChannelState | "none";
  messages: ChatEntry[];
  chatError: string | null;
  error: string | null;
};

export type ChatEntry = ChatMessage & {
  direction: "incoming" | "outgoing";
};

export type SendChatResult = { ok: true } | { ok: false; error: string };

export const INITIAL_PEER_ROOM_STATE: PeerRoomState = {
  phase: "signaling",
  role: null,
  peerConnection: "new",
  dataChannel: "none",
  messages: [],
  chatError: null,
  error: null,
};

type SessionOptions = {
  roomId: string;
  signalingUrl: string;
  onStateChange: (state: PeerRoomState) => void;
};

export class PeerRoomSession {
  private readonly roomId: string;
  private readonly signalingUrl: string;
  private readonly onStateChange: (state: PeerRoomState) => void;
  private state: PeerRoomState = INITIAL_PEER_ROOM_STATE;
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private role: PeerRole | null = null;
  private pendingCandidates: IceCandidateMessage[] = [];
  private messageQueue: Promise<void> = Promise.resolve();
  private makingOffer = false;
  private readonly seenChatMessageIds = new Set<string>();
  private disposed = false;

  constructor(options: SessionOptions) {
    this.roomId = options.roomId;
    this.signalingUrl = options.signalingUrl;
    this.onStateChange = options.onStateChange;
  }

  connect(): void {
    this.update({ phase: "signaling", error: null });
    const socket = new WebSocket(createSocketUrl(this.signalingUrl, this.roomId));
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (!this.disposed) this.update({ phase: "waiting" });
    });
    socket.addEventListener("message", (event) => {
      if (this.disposed) return;
      this.messageQueue = this.messageQueue
        .then(() => this.handleSocketMessage(event.data))
        .catch((error: unknown) => this.fail(error));
    });
    socket.addEventListener("error", () => {
      if (!this.disposed) this.fail(new Error("Unable to connect. The room may be full."));
    });
    socket.addEventListener("close", () => {
      if (!this.disposed && this.state.phase !== "error") {
        this.resetPeerConnection();
        this.update({ phase: "disconnected" });
      }
    });
  }

  disconnect(): void {
    this.disposed = true;
    this.resetPeerConnection();
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(1000, "Page closed");
    }
    this.socket = null;
  }

  sendChatMessage(text: string): SendChatResult {
    const normalizedText = text.trim();
    if (normalizedText.length === 0) return { ok: false, error: "Enter a message first." };
    if (normalizedText.length > CHAT_MESSAGE_MAX_LENGTH) {
      return {
        ok: false,
        error: `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString()} characters.`,
      };
    }
    if (!this.channel || this.channel.readyState !== "open") {
      return { ok: false, error: "Wait for the peer connection before sending." };
    }

    const message: ChatMessage = {
      type: "chat",
      id: createMessageId(),
      timestamp: Date.now(),
      text: normalizedText,
    };

    try {
      this.channel.send(JSON.stringify(message));
      this.seenChatMessageIds.add(message.id);
      this.appendMessage({ ...message, direction: "outgoing" });
      return { ok: true };
    } catch {
      return { ok: false, error: "The message could not be sent." };
    }
  }

  private async handleSocketMessage(rawData: unknown): Promise<void> {
    if (typeof rawData !== "string") throw new Error("Received a non-text signaling frame");

    let value: unknown;
    try {
      value = JSON.parse(rawData);
    } catch {
      throw new Error("Received malformed signaling data");
    }
    if (!isServerSignalingMessage(value)) throw new Error("Received invalid signaling data");

    await this.handleMessage(value);
  }

  private async handleMessage(message: ServerSignalingMessage): Promise<void> {
    switch (message.type) {
      case "room-joined":
        this.role = message.role;
        this.update({
          role: message.role,
          phase: message.peerCount === 2 ? "negotiating" : "waiting",
        });
        this.ensurePeerConnection();
        if (message.role === "initiator" && message.peerCount === 2) await this.startOffer();
        return;
      case "peer-joined":
        this.update({ phase: "negotiating", error: null });
        this.ensurePeerConnection();
        if (this.role === "initiator") await this.startOffer();
        return;
      case "offer":
        await this.receiveOffer(message.sdp);
        return;
      case "answer":
        await this.receiveAnswer(message.sdp);
        return;
      case "ice-candidate":
        await this.receiveCandidate(message);
        return;
      case "peer-left":
        this.resetPeerConnection();
        this.ensurePeerConnection();
        this.update({ phase: "waiting", error: null });
        return;
      case "error":
        if (message.code === "peer-unavailable") {
          this.update({ phase: "waiting", error: null });
          return;
        }
        throw new Error(message.message);
    }
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.peer && this.peer.signalingState !== "closed") return this.peer;

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    });
    this.peer = peer;

    peer.addEventListener("icecandidate", (event) => {
      if (this.disposed || !event.candidate) return;
      const candidate = event.candidate.toJSON();
      this.send({
        type: "ice-candidate",
        candidate: candidate.candidate ?? "",
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        usernameFragment: candidate.usernameFragment ?? null,
      });
    });
    peer.addEventListener("connectionstatechange", () => {
      this.update({ peerConnection: peer.connectionState });
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        this.update({ phase: "disconnected" });
      }
    });
    peer.addEventListener("datachannel", (event) => {
      if (event.channel.label !== "control") {
        event.channel.close();
        return;
      }
      this.bindDataChannel(event.channel);
    });

    this.update({ peerConnection: peer.connectionState });
    return peer;
  }

  private async startOffer(): Promise<void> {
    if (this.makingOffer || this.role !== "initiator") return;
    this.makingOffer = true;
    try {
      const peer = this.ensurePeerConnection();
      if (!this.channel || this.channel.readyState === "closed") {
        this.bindDataChannel(peer.createDataChannel("control", { ordered: true }));
      }
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!peer.localDescription?.sdp) throw new Error("Browser did not create an SDP offer");
      this.send({ type: "offer", sdp: peer.localDescription.sdp });
    } finally {
      this.makingOffer = false;
    }
  }

  private async receiveOffer(sdp: string): Promise<void> {
    if (this.role !== "responder") throw new Error("Unexpected SDP offer for initiator");
    const peer = this.ensurePeerConnection();
    await peer.setRemoteDescription({ type: "offer", sdp });
    await this.flushCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (!peer.localDescription?.sdp) throw new Error("Browser did not create an SDP answer");
    this.send({ type: "answer", sdp: peer.localDescription.sdp });
  }

  private async receiveAnswer(sdp: string): Promise<void> {
    if (this.role !== "initiator") throw new Error("Unexpected SDP answer for responder");
    const peer = this.ensurePeerConnection();
    await peer.setRemoteDescription({ type: "answer", sdp });
    await this.flushCandidates();
  }

  private async receiveCandidate(message: IceCandidateMessage): Promise<void> {
    const peer = this.ensurePeerConnection();
    if (!peer.remoteDescription) {
      this.pendingCandidates.push(message);
      return;
    }
    await peer.addIceCandidate(toIceCandidateInit(message));
  }

  private async flushCandidates(): Promise<void> {
    const peer = this.ensurePeerConnection();
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await peer.addIceCandidate(toIceCandidateInit(candidate));
    }
  }

  private bindDataChannel(channel: RTCDataChannel): void {
    this.channel?.close();
    this.channel = channel;
    this.update({ dataChannel: channel.readyState });

    channel.addEventListener("open", () => {
      this.update({ phase: "connected", dataChannel: "open", error: null });
    });
    channel.addEventListener("message", (event) => this.handleControlMessage(event.data));
    channel.addEventListener("closing", () => this.update({ dataChannel: "closing" }));
    channel.addEventListener("close", () => {
      if (!this.disposed) this.update({ dataChannel: "closed" });
    });
    channel.addEventListener("error", () => this.fail(new Error("The control DataChannel failed")));
  }

  private send(message: ClientSignalingMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling socket is not open");
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleControlMessage(rawData: unknown): void {
    if (typeof rawData !== "string") {
      this.update({ chatError: "The peer sent an unsupported control message." });
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(rawData);
    } catch {
      this.update({ chatError: "The peer sent malformed chat data." });
      return;
    }

    if (!isChatMessage(value)) {
      this.update({ chatError: "The peer sent an invalid chat message." });
      return;
    }
    if (this.seenChatMessageIds.has(value.id)) return;

    this.seenChatMessageIds.add(value.id);
    this.appendMessage({ ...value, direction: "incoming" });
  }

  private appendMessage(message: ChatEntry): void {
    const messages = [...this.state.messages, message].slice(-MAX_VISIBLE_CHAT_MESSAGES);
    this.update({ messages, chatError: null });
  }

  private resetPeerConnection(): void {
    this.pendingCandidates = [];
    this.seenChatMessageIds.clear();
    this.channel?.close();
    this.peer?.close();
    this.channel = null;
    this.peer = null;
    this.update({
      peerConnection: "closed",
      dataChannel: "none",
      messages: [],
      chatError: null,
    });
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    const message = error instanceof Error ? error.message : "Connection failed";
    this.update({ phase: "error", error: message });
  }

  private update(patch: Partial<PeerRoomState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onStateChange(this.state);
  }
}

function createSocketUrl(signalingUrl: string, roomId: string): string {
  const url = new URL(signalingUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/rooms/${roomId}/socket`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function toIceCandidateInit(message: IceCandidateMessage): RTCIceCandidateInit {
  const candidate: RTCIceCandidateInit = {
    candidate: message.candidate,
    sdpMid: message.sdpMid,
    sdpMLineIndex: message.sdpMLineIndex,
  };
  if (message.usernameFragment !== null) candidate.usernameFragment = message.usernameFragment;
  return candidate;
}

function createMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
