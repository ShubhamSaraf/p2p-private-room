import {
  AUTH_PROTOCOL_VERSION,
  CHAT_MESSAGE_MAX_LENGTH,
  ENCRYPTION_PROTOCOL_VERSION,
  type AuthenticationMessage,
  type ChatMessage,
  type ClientSignalingMessage,
  type IceCandidateMessage,
  type PeerRole,
  type ServerSignalingMessage,
  isControlMessage,
  isChatMessage,
  isServerSignalingMessage,
} from "@peerlink/protocol";
import {
  PAKE_CONFIRMATION_BYTES,
  PAKE_SESSION_ID_BYTES,
  PAKE_SHARE_BYTES,
  ApplicationCipher,
  deriveApplicationCipher,
  destroyPakeResult,
  destroyPakeState,
  finishPake,
  startPake,
  validateSharedSecret,
  verifyPakeConfirmation,
  type PakeResult,
  type PakeState,
} from "@peerlink/crypto";

const MAX_VISIBLE_CHAT_MESSAGES = 500;

export type RoomPhase =
  "signaling" | "waiting" | "negotiating" | "connected" | "disconnected" | "error";

export type AuthenticationPhase =
  "waiting-for-peer" | "required" | "authenticating" | "verified" | "failed";

export type PeerRoomState = {
  phase: RoomPhase;
  role: PeerRole | null;
  peerConnection: RTCPeerConnectionState;
  dataChannel: RTCDataChannelState | "none";
  authentication: AuthenticationPhase;
  authError: string | null;
  messages: ChatEntry[];
  chatError: string | null;
  error: string | null;
};

export type ChatEntry = ChatMessage & {
  direction: "incoming" | "outgoing";
};

export type SendChatResult = { ok: true } | { ok: false; error: string };
export type StartAuthenticationResult = { ok: true } | { ok: false; error: string };

export const INITIAL_PEER_ROOM_STATE: PeerRoomState = {
  phase: "signaling",
  role: null,
  peerConnection: "new",
  dataChannel: "none",
  authentication: "waiting-for-peer",
  authError: null,
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
  private controlMessageQueue: Promise<void> = Promise.resolve();
  private makingOffer = false;
  private readonly seenChatMessageIds = new Set<string>();
  private authenticationAttempted = false;
  private pendingSecret: string | null = null;
  private pendingPeerShare: Extract<AuthenticationMessage, { type: "pake-share" }> | null = null;
  private pendingPeerConfirmation: Uint8Array | null = null;
  private pakeState: PakeState | null = null;
  private pakeResult: PakeResult | null = null;
  private applicationCipher: ApplicationCipher | null = null;
  private authSessionId: string | null = null;
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
    if (this.state.authentication !== "verified") {
      return { ok: false, error: "Verify the shared secret before sending messages." };
    }

    const message: ChatMessage = {
      type: "chat",
      id: createMessageId(),
      timestamp: Date.now(),
      text: normalizedText,
    };

    try {
      this.sendEncryptedControl(message);
      this.seenChatMessageIds.add(message.id);
      this.appendMessage({ ...message, direction: "outgoing" });
      return { ok: true };
    } catch {
      return { ok: false, error: "The message could not be sent." };
    }
  }

  async startAuthentication(secret: string): Promise<StartAuthenticationResult> {
    const validationError = validateSharedSecret(secret);
    if (validationError) return { ok: false, error: validationError };
    if (!this.channel || this.channel.readyState !== "open" || !this.role) {
      return { ok: false, error: "Wait for the peer connection before entering the secret." };
    }
    if (this.state.authentication === "verified") {
      return { ok: false, error: "This peer is already verified." };
    }
    if (this.authenticationAttempted) {
      return { ok: false, error: "Authentication was already attempted for this connection." };
    }

    this.authenticationAttempted = true;
    this.update({ authentication: "authenticating", authError: null });

    try {
      if (this.role === "initiator") {
        const sid = crypto.getRandomValues(new Uint8Array(PAKE_SESSION_ID_BYTES));
        this.pakeState = startPake({
          secret,
          sid,
          channelId: this.channelId(),
          role: "initiator",
        });
        this.authSessionId = encodeBase64Url(sid);
        this.sendControl({
          type: "pake-share",
          version: AUTH_PROTOCOL_VERSION,
          sessionId: this.authSessionId,
          share: encodeBase64Url(this.pakeState.ownShare),
        });
      } else if (this.pendingPeerShare) {
        await this.finishResponderAuthentication(secret, this.pendingPeerShare);
      } else {
        this.pendingSecret = secret;
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      this.failAuthentication(message);
      return { ok: false, error: message };
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
      this.update({
        phase: "connected",
        dataChannel: "open",
        authentication: "required",
        authError: null,
        error: null,
      });
    });
    channel.addEventListener("message", (event) => {
      this.controlMessageQueue = this.controlMessageQueue
        .then(() => this.handleControlMessage(event.data))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Authentication failed.";
          this.failAuthentication(message);
        });
    });
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

  private async handleControlMessage(rawData: unknown): Promise<void> {
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

    if (isChatMessage(value)) {
      this.update({ chatError: "The peer sent a forbidden plaintext chat message." });
      return;
    }
    if (!isControlMessage(value)) {
      this.update({ chatError: "The peer sent an invalid control message." });
      return;
    }

    if (value.type === "pake-share") {
      await this.receivePakeShare(value);
      return;
    }
    if (value.type === "pake-confirm") {
      await this.receivePakeConfirmation(decodeBase64Url(value.confirmation));
      return;
    }
    if (this.state.authentication !== "verified" || !this.applicationCipher) {
      this.update({ chatError: "The peer sent encrypted data before authentication." });
      return;
    }

    const plaintext = this.applicationCipher.decrypt({
      counter: value.counter,
      ciphertext: decodeBase64Url(value.ciphertext),
    });
    let applicationMessage: unknown;
    try {
      applicationMessage = JSON.parse(new TextDecoder().decode(plaintext));
    } finally {
      plaintext.fill(0);
    }
    if (!isChatMessage(applicationMessage)) {
      this.update({ chatError: "The peer sent an invalid encrypted application message." });
      return;
    }
    if (this.seenChatMessageIds.has(applicationMessage.id)) return;

    this.seenChatMessageIds.add(applicationMessage.id);
    this.appendMessage({ ...applicationMessage, direction: "incoming" });
  }

  private async receivePakeShare(
    message: Extract<AuthenticationMessage, { type: "pake-share" }>,
  ): Promise<void> {
    if (!this.role) throw new Error("Received authentication data before joining the room.");

    if (this.role === "responder") {
      if (this.pendingPeerShare || this.pakeState || this.pakeResult) {
        throw new Error("The peer sent a duplicate authentication share.");
      }
      this.pendingPeerShare = message;
      if (this.pendingSecret) {
        const secret = this.pendingSecret;
        this.pendingSecret = null;
        await this.finishResponderAuthentication(secret, message);
      }
      return;
    }

    if (!this.authenticationAttempted || !this.pakeState || !this.authSessionId) {
      throw new Error("The peer started authentication out of order.");
    }
    if (message.sessionId !== this.authSessionId || this.pakeResult) {
      throw new Error("The peer sent invalid authentication session data.");
    }

    await this.deriveAndConfirm(decodeFixed(message.share, PAKE_SHARE_BYTES, "PAKE share"));
  }

  private async finishResponderAuthentication(
    secret: string,
    message: Extract<AuthenticationMessage, { type: "pake-share" }>,
  ): Promise<void> {
    const sid = decodeFixed(message.sessionId, PAKE_SESSION_ID_BYTES, "PAKE session ID");
    const peerShare = decodeFixed(message.share, PAKE_SHARE_BYTES, "PAKE share");
    this.authSessionId = message.sessionId;
    this.pakeState = startPake({
      secret,
      sid,
      channelId: this.channelId(),
      role: "responder",
    });
    this.sendControl({
      type: "pake-share",
      version: AUTH_PROTOCOL_VERSION,
      sessionId: message.sessionId,
      share: encodeBase64Url(this.pakeState.ownShare),
    });
    await this.deriveAndConfirm(peerShare);
  }

  private async deriveAndConfirm(peerShare: Uint8Array): Promise<void> {
    if (!this.pakeState) throw new Error("Authentication state is missing.");
    this.pakeResult = await finishPake({ state: this.pakeState, peerShare });
    destroyPakeState(this.pakeState);
    this.pakeState = null;
    this.sendControl({
      type: "pake-confirm",
      version: AUTH_PROTOCOL_VERSION,
      confirmation: encodeBase64Url(this.pakeResult.ownConfirmation),
    });

    if (this.pendingPeerConfirmation) {
      const confirmation = this.pendingPeerConfirmation;
      this.pendingPeerConfirmation = null;
      await this.receivePakeConfirmation(confirmation);
    }
  }

  private async receivePakeConfirmation(confirmation: Uint8Array): Promise<void> {
    if (confirmation.length !== PAKE_CONFIRMATION_BYTES) {
      throw new Error("The peer sent an invalid confirmation.");
    }
    if (!this.pakeResult) {
      if (this.pendingPeerConfirmation) throw new Error("The peer sent duplicate confirmations.");
      this.pendingPeerConfirmation = confirmation;
      return;
    }

    const verified = await verifyPakeConfirmation(this.pakeResult, confirmation);
    confirmation.fill(0);
    if (!verified) {
      this.failAuthentication("Shared secrets do not match. Start a new room to try again.");
      return;
    }
    this.applicationCipher = deriveApplicationCipher({
      sessionKey: this.pakeResult.sessionKey,
      channelId: this.channelId(),
      role: this.role ?? "initiator",
    });
    destroyPakeResult(this.pakeResult);
    this.pakeResult = null;
    this.update({ authentication: "verified", authError: null, chatError: null });
  }

  private sendEncryptedControl(message: ChatMessage): void {
    if (!this.channel || this.channel.readyState !== "open" || !this.applicationCipher) {
      throw new Error("Application encryption is not active.");
    }
    const plaintext = new TextEncoder().encode(JSON.stringify(message));
    try {
      const encrypted = this.applicationCipher.encrypt(plaintext);
      this.channel.send(
        JSON.stringify({
          type: "encrypted",
          version: ENCRYPTION_PROTOCOL_VERSION,
          counter: encrypted.counter,
          ciphertext: encodeBase64Url(encrypted.ciphertext),
        }),
      );
    } finally {
      plaintext.fill(0);
    }
  }

  private sendControl(message: AuthenticationMessage): void {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("The control DataChannel is not open.");
    }
    this.channel.send(JSON.stringify(message));
  }

  private channelId(): Uint8Array {
    return new TextEncoder().encode(`peerlink/control/v1/room/${this.roomId}`);
  }

  private failAuthentication(message: string): void {
    this.pendingSecret = null;
    destroyPakeState(this.pakeState);
    destroyPakeResult(this.pakeResult);
    this.pakeState = null;
    this.pakeResult = null;
    this.applicationCipher?.destroy();
    this.applicationCipher = null;
    this.pendingPeerConfirmation?.fill(0);
    this.pendingPeerConfirmation = null;
    this.update({ authentication: "failed", authError: message });
  }

  private appendMessage(message: ChatEntry): void {
    const messages = [...this.state.messages, message].slice(-MAX_VISIBLE_CHAT_MESSAGES);
    this.update({ messages, chatError: null });
  }

  private resetPeerConnection(): void {
    this.pendingCandidates = [];
    this.seenChatMessageIds.clear();
    this.authenticationAttempted = false;
    this.pendingSecret = null;
    this.pendingPeerShare = null;
    this.pendingPeerConfirmation?.fill(0);
    this.pendingPeerConfirmation = null;
    destroyPakeState(this.pakeState);
    destroyPakeResult(this.pakeResult);
    this.pakeState = null;
    this.pakeResult = null;
    this.applicationCipher?.destroy();
    this.applicationCipher = null;
    this.authSessionId = null;
    this.channel?.close();
    this.peer?.close();
    this.channel = null;
    this.peer = null;
    this.update({
      peerConnection: "closed",
      dataChannel: "none",
      authentication: "waiting-for-peer",
      authError: null,
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

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeFixed(value: string, length: number, label: string): Uint8Array {
  const decoded = decodeBase64Url(value);
  if (decoded.length !== length) throw new Error(`${label} must be ${length} bytes.`);
  return decoded;
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
