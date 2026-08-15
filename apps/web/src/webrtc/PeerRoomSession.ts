import {
  AUTH_PROTOCOL_VERSION,
  CHAT_MESSAGE_MAX_LENGTH,
  ENCRYPTION_PROTOCOL_VERSION,
  type AuthenticationMessage,
  type ApplicationMessage,
  type ChatMessage,
  type ClientSignalingMessage,
  type IceCandidateMessage,
  type PeerRole,
  type FileOfferMessage,
  type TransferControlMessage,
  type ServerSignalingMessage,
  isControlMessage,
  isChatMessage,
  isApplicationMessage,
  isServerSignalingMessage,
  isTurnCredentials,
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
import {
  TRANSFER_CHUNK_SIZE,
  TransferHasher,
  chunkCount,
  decodeTransferChunk,
  encodeTransferChunk,
  isValidResumePoint,
  waitForTransferCapacity,
} from "@peerlink/transfer";

const MAX_VISIBLE_CHAT_MESSAGES = 500;

export type RoomPhase =
  "signaling" | "waiting" | "negotiating" | "connected" | "reconnecting" | "disconnected" | "error";

export type AuthenticationPhase =
  "waiting-for-peer" | "required" | "authenticating" | "verified" | "failed";

export type ConnectionPath = "unknown" | "direct" | "relay";
export type TurnAvailability = "checking" | "available" | "unavailable";

export type PeerRoomState = {
  phase: RoomPhase;
  role: PeerRole | null;
  peerConnection: RTCPeerConnectionState;
  dataChannel: RTCDataChannelState | "none";
  connectionPath: ConnectionPath;
  turnAvailability: TurnAvailability;
  authentication: AuthenticationPhase;
  authError: string | null;
  messages: ChatEntry[];
  transfers: TransferEntry[];
  chatError: string | null;
  error: string | null;
};

export type ChatEntry = ChatMessage & {
  direction: "incoming" | "outgoing";
};

export type TransferEntry = FileOfferMessage & {
  direction: "incoming" | "outgoing";
  status:
    | "offered"
    | "waiting"
    | "transferring"
    | "paused"
    | "completed"
    | "declined"
    | "cancelled"
    | "failed";
  bytesTransferred: number;
  integrity: "pending" | "verified" | "failed";
  objectUrl?: string;
  error?: string;
};

export type SendChatResult = { ok: true } | { ok: false; error: string };
export type StartAuthenticationResult = { ok: true } | { ok: false; error: string };
export type TransferActionResult = { ok: true } | { ok: false; error: string };

export const INITIAL_PEER_ROOM_STATE: PeerRoomState = {
  phase: "signaling",
  role: null,
  peerConnection: "new",
  dataChannel: "none",
  connectionPath: "unknown",
  turnAvailability: "checking",
  authentication: "waiting-for-peer",
  authError: null,
  messages: [],
  transfers: [],
  chatError: null,
  error: null,
};

type SessionOptions = {
  roomId: string;
  signalingUrl: string;
  onStateChange: (state: PeerRoomState) => void;
};

type OutgoingTransfer = {
  file: File;
  controller: AbortController;
  paused: boolean;
  nextChunk: number;
  sentBytes: number;
  resume: (() => void) | null;
  generation: number;
  transmitting: boolean;
  accepted: boolean;
};

export class PeerRoomSession {
  private readonly roomId: string;
  private readonly signalingUrl: string;
  private readonly onStateChange: (state: PeerRoomState) => void;
  private state: PeerRoomState = INITIAL_PEER_ROOM_STATE;
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private iceServers: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
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
  private readonly outgoingFiles = new Map<string, OutgoingTransfer>();
  private readonly incomingFiles = new Map<
    string,
    {
      offer: FileOfferMessage;
      chunks: Uint8Array[];
      hasher: TransferHasher;
      nextChunk: number;
      receivedBytes: number;
      lastProgressAt: number;
    }
  >();
  private readonly objectUrls = new Set<string>();
  private authSessionId: string | null = null;
  private disposed = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private reconnectDeadline = 0;
  private hasOpenedSocket = false;
  private connectionInterrupted = false;

  constructor(options: SessionOptions) {
    this.roomId = options.roomId;
    this.signalingUrl = options.signalingUrl;
    this.onStateChange = options.onStateChange;
  }

  connect(): void {
    this.update({ phase: "signaling", error: null });
    void this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      const response = await fetch(`${this.signalingUrl}/api/turn-credentials`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok) {
        const value: unknown = await response.json();
        if (isTurnCredentials(value)) {
          this.iceServers = [
            this.iceServers[0] as RTCIceServer,
            ...value.iceServers.map((server) => ({ ...server })),
          ];
          this.update({ turnAvailability: "available" });
        } else {
          this.update({ turnAvailability: "unavailable" });
        }
      } else {
        this.update({ turnAvailability: "unavailable" });
      }
    } catch {
      this.update({ turnAvailability: "unavailable" });
    }
    if (this.disposed) return;

    this.openSocket();
  }

  private openSocket(): void {
    if (this.disposed) return;
    const socket = new WebSocket(createSocketUrl(this.signalingUrl, this.roomId));
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.disposed) return;
      this.hasOpenedSocket = true;
      this.reconnectAttempt = 0;
      this.reconnectDeadline = 0;
      this.update({ phase: "waiting", error: null });
    });
    socket.addEventListener("message", (event) => {
      if (this.disposed) return;
      this.messageQueue = this.messageQueue
        .then(() => this.handleSocketMessage(event.data))
        .catch((error: unknown) => this.fail(error));
    });
    socket.addEventListener("error", () => {
      if (this.disposed) return;
      if (!this.hasOpenedSocket) {
        this.fail(new Error("Unable to connect. The room may be full or expired."));
      } else if (socket.readyState < WebSocket.CLOSING) {
        socket.close(1012, "Signaling connection interrupted");
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      if (this.disposed || !this.hasOpenedSocket) return;
      this.role = null;
      this.connectionInterrupted = true;
      this.resetPeerConnection(true);
      this.update({
        role: null,
        phase: "reconnecting",
        error: "Connection interrupted. Reconnecting for up to five minutes.",
      });
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const now = Date.now();
    if (this.reconnectDeadline === 0) this.reconnectDeadline = now + 5 * 60 * 1_000;
    if (now >= this.reconnectDeadline) {
      this.update({ phase: "disconnected", error: "The five-minute reconnect window expired." });
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 15_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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

  offerFile(file: File, category: "image" | "file"): TransferActionResult {
    if (this.state.authentication !== "verified" || !this.applicationCipher) {
      return { ok: false, error: "Verify the shared secret before sharing files." };
    }
    if (!file.name || file.name.length > 255 || hasControlCharacters(file.name)) {
      return { ok: false, error: "Choose a file with a valid name." };
    }
    if (category === "image" && !isSupportedImage(file)) {
      return { ok: false, error: "Images must be JPEG, PNG, WebP, or GIF." };
    }

    const id = createMessageId();
    const offer: FileOfferMessage = {
      type: "file-offer",
      id,
      name: file.name,
      size: file.size,
      mime: file.type.slice(0, 255),
      category,
      lastModified: Math.max(0, file.lastModified),
      ...getSafeRelativePath(file),
    };
    this.outgoingFiles.set(id, {
      file,
      controller: new AbortController(),
      paused: false,
      nextChunk: 0,
      sentBytes: 0,
      resume: null,
      generation: 0,
      transmitting: false,
      accepted: false,
    });
    this.appendTransfer({
      ...offer,
      direction: "outgoing",
      status: "waiting",
      bytesTransferred: 0,
      integrity: "pending",
    });
    this.sendEncryptedControl(offer);
    return { ok: true };
  }

  acceptTransfer(id: string): TransferActionResult {
    const transfer = this.incomingFiles.get(id);
    if (!transfer || this.transferById(id)?.status !== "offered") {
      return { ok: false, error: "This file offer is no longer available." };
    }
    this.updateTransfer(id, { status: "transferring" });
    this.sendEncryptedControl({ type: "file-accept", id });
    return { ok: true };
  }

  declineTransfer(id: string): TransferActionResult {
    if (!this.incomingFiles.has(id)) return { ok: false, error: "File offer not found." };
    this.incomingFiles.delete(id);
    this.updateTransfer(id, { status: "declined" });
    this.sendEncryptedControl({ type: "file-decline", id });
    return { ok: true };
  }

  cancelTransfer(id: string): TransferActionResult {
    const outgoing = this.outgoingFiles.get(id);
    outgoing?.controller.abort();
    this.outgoingFiles.delete(id);
    this.incomingFiles.delete(id);
    if (!this.transferById(id)) return { ok: false, error: "Transfer not found." };
    this.updateTransfer(id, { status: "cancelled" });
    this.sendEncryptedControl({ type: "file-cancel", id, reason: "Cancelled by peer." });
    return { ok: true };
  }

  pauseTransfer(id: string): TransferActionResult {
    const outgoing = this.outgoingFiles.get(id);
    const incoming = this.incomingFiles.get(id);
    const transfer = this.transferById(id);
    if (!transfer || transfer.status !== "transferring" || (!outgoing && !incoming)) {
      return { ok: false, error: "This transfer cannot be paused." };
    }
    if (outgoing) outgoing.paused = true;
    this.updateTransfer(id, { status: "paused" });
    this.sendEncryptedControl({ type: "file-pause", id });
    return { ok: true };
  }

  resumeTransfer(id: string): TransferActionResult {
    const outgoing = this.outgoingFiles.get(id);
    const incoming = this.incomingFiles.get(id);
    const transfer = this.transferById(id);
    if (!transfer || transfer.status !== "paused" || (!outgoing && !incoming)) {
      return { ok: false, error: "This transfer cannot be resumed." };
    }
    const nextChunk = outgoing?.nextChunk ?? incoming?.nextChunk ?? 0;
    const byteOffset = outgoing?.sentBytes ?? incoming?.receivedBytes ?? 0;
    if (outgoing) {
      outgoing.paused = false;
      outgoing.resume?.();
      outgoing.resume = null;
    }
    this.updateTransfer(id, { status: "transferring" });
    this.sendEncryptedControl({ type: "file-resume", id, nextChunk, byteOffset });
    return { ok: true };
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
        this.connectionInterrupted = true;
        this.resetPeerConnection(true);
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

    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
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
      if (peer.connectionState === "connected") void this.detectConnectionPath(peer);
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

  private async detectConnectionPath(peer: RTCPeerConnection): Promise<void> {
    try {
      const stats = await peer.getStats();
      let pair: Record<string, unknown> | undefined;
      for (const report of stats.values()) {
        const value = report as unknown as Record<string, unknown>;
        if (
          value.type === "candidate-pair" &&
          (value.selected === true || (value.nominated === true && value.state === "succeeded"))
        ) {
          pair = value;
          break;
        }
      }
      if (!pair) {
        for (const report of stats.values()) {
          const value = report as unknown as Record<string, unknown>;
          if (value.type !== "transport" || typeof value.selectedCandidatePairId !== "string") {
            continue;
          }
          pair = stats.get(value.selectedCandidatePairId) as unknown as Record<string, unknown>;
          if (pair) break;
        }
      }
      if (!pair) return;
      const local =
        typeof pair.localCandidateId === "string"
          ? (stats.get(pair.localCandidateId) as unknown as Record<string, unknown>)
          : undefined;
      const remote =
        typeof pair.remoteCandidateId === "string"
          ? (stats.get(pair.remoteCandidateId) as unknown as Record<string, unknown>)
          : undefined;
      const relayed = local?.candidateType === "relay" || remote?.candidateType === "relay";
      this.update({ connectionPath: relayed ? "relay" : "direct" });
    } catch {
      this.update({ connectionPath: "unknown" });
    }
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
    channel.binaryType = "arraybuffer";
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
    if (rawData instanceof ArrayBuffer) {
      this.handleEncryptedBinary(new Uint8Array(rawData));
      return;
    }
    if (rawData instanceof Blob) {
      this.handleEncryptedBinary(new Uint8Array(await rawData.arrayBuffer()));
      return;
    }
    if (typeof rawData !== "string") {
      this.update({ chatError: "The peer sent an unsupported DataChannel frame." });
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
    if (!isApplicationMessage(applicationMessage)) {
      this.update({ chatError: "The peer sent an invalid encrypted application message." });
      return;
    }
    if (applicationMessage.type !== "chat") {
      await this.handleTransferControl(applicationMessage);
      return;
    }
    if (this.seenChatMessageIds.has(applicationMessage.id)) return;

    this.seenChatMessageIds.add(applicationMessage.id);
    this.appendMessage({ ...applicationMessage, direction: "incoming" });
  }

  private handleEncryptedBinary(frame: Uint8Array): void {
    if (this.state.authentication !== "verified" || !this.applicationCipher) {
      throw new Error("The peer sent binary data before authentication.");
    }
    const encrypted = decodeEncryptedBinaryFrame(frame);
    const plaintext = this.applicationCipher.decrypt(encrypted);
    try {
      this.receiveTransferChunk(decodeTransferChunk(plaintext));
    } finally {
      plaintext.fill(0);
    }
  }

  private async handleTransferControl(message: TransferControlMessage): Promise<void> {
    switch (message.type) {
      case "file-offer": {
        if (this.incomingFiles.has(message.id) || this.transferById(message.id)) {
          throw new Error("The peer reused a transfer ID.");
        }
        this.incomingFiles.set(message.id, {
          offer: message,
          chunks: [],
          hasher: new TransferHasher(),
          nextChunk: 0,
          receivedBytes: 0,
          lastProgressAt: 0,
        });
        this.appendTransfer({
          ...message,
          direction: "incoming",
          status: "offered",
          bytesTransferred: 0,
          integrity: "pending",
        });
        return;
      }
      case "file-accept": {
        const outgoing = this.outgoingFiles.get(message.id);
        if (!outgoing || this.transferById(message.id)?.status !== "waiting") {
          throw new Error("The peer accepted an unknown file offer.");
        }
        outgoing.accepted = true;
        this.startTransmitFile(message.id, outgoing);
        return;
      }
      case "file-decline":
        this.outgoingFiles.delete(message.id);
        this.updateTransfer(message.id, { status: "declined" });
        return;
      case "file-cancel":
        this.outgoingFiles.get(message.id)?.controller.abort();
        this.outgoingFiles.delete(message.id);
        this.incomingFiles.delete(message.id);
        this.updateTransfer(message.id, { status: "cancelled", error: message.reason });
        return;
      case "file-pause": {
        const outgoing = this.outgoingFiles.get(message.id);
        const incoming = this.incomingFiles.get(message.id);
        if (!outgoing && !incoming) throw new Error("The peer paused an unknown transfer.");
        if (outgoing) outgoing.paused = true;
        this.updateTransfer(message.id, { status: "paused" });
        return;
      }
      case "file-resume": {
        const outgoing = this.outgoingFiles.get(message.id);
        const incoming = this.incomingFiles.get(message.id);
        const expectedChunk = outgoing?.nextChunk ?? incoming?.nextChunk;
        const expectedOffset = outgoing?.sentBytes ?? incoming?.receivedBytes;
        if (expectedChunk === undefined || expectedOffset === undefined) {
          throw new Error("The peer resumed an unknown transfer.");
        }
        if (
          incoming &&
          (expectedChunk !== message.nextChunk || expectedOffset !== message.byteOffset)
        ) {
          throw new Error("The peer sent inconsistent transfer resume state.");
        }
        if (outgoing) {
          if (!isValidResumePoint(outgoing.file.size, message.nextChunk, message.byteOffset)) {
            throw new Error("The peer sent an invalid transfer resume offset.");
          }
          if (
            outgoing.transmitting &&
            (outgoing.nextChunk !== message.nextChunk || outgoing.sentBytes !== message.byteOffset)
          ) {
            throw new Error("The peer sent inconsistent live transfer state.");
          }
          outgoing.nextChunk = message.nextChunk;
          outgoing.sentBytes = message.byteOffset;
          outgoing.paused = false;
          outgoing.resume?.();
          outgoing.resume = null;
          this.startTransmitFile(message.id, outgoing);
        }
        this.updateTransfer(message.id, {
          status: "transferring",
          bytesTransferred: message.byteOffset,
        });
        return;
      }
      case "file-resume-offer": {
        const incoming = this.incomingFiles.get(message.id);
        if (!incoming || incoming.offer.size !== message.size) {
          this.sendEncryptedControl({
            type: "file-cancel",
            id: message.id,
            reason: "Partial transfer state is unavailable.",
          });
          return;
        }
        this.updateTransfer(message.id, { status: "paused" });
        this.sendEncryptedControl({
          type: "file-resume",
          id: message.id,
          nextChunk: incoming.nextChunk,
          byteOffset: incoming.receivedBytes,
        });
        return;
      }
      case "file-complete":
        this.completeIncomingTransfer(message);
        return;
      case "file-verified": {
        const transfer = this.transferById(message.id);
        if (!transfer || transfer.direction !== "outgoing" || transfer.status !== "completed") {
          throw new Error("Received verification for an unknown transfer.");
        }
        this.updateTransfer(message.id, { integrity: "verified" });
        return;
      }
    }
  }

  private startTransmitFile(id: string, outgoing: OutgoingTransfer): void {
    if (outgoing.transmitting) return;
    void this.transmitFile(id, outgoing).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (this.connectionInterrupted && this.outgoingFiles.has(id)) {
        outgoing.paused = true;
        this.updateTransfer(id, { status: "paused", error: "Waiting to reconnect." });
        return;
      }
      const detail = error instanceof Error ? error.message : "Transfer failed.";
      this.updateTransfer(id, { status: "failed", error: detail });
      this.trySendTransferCancel(id, "Sender transfer failed.");
    });
  }

  private async transmitFile(id: string, outgoing: OutgoingTransfer): Promise<void> {
    outgoing.transmitting = true;
    const { file, controller } = outgoing;
    const generation = outgoing.generation;
    let sentBytes = outgoing.sentBytes;
    let index = outgoing.nextChunk;
    let lastProgressAt = 0;
    this.updateTransfer(id, { status: "transferring" });

    try {
      const hasher = await hashFilePrefix(file, outgoing.sentBytes, controller.signal);
      while (sentBytes < file.size) {
        if (controller.signal.aborted) throw new DOMException("Transfer cancelled.", "AbortError");
        if (outgoing.paused) await waitUntilResumed(outgoing);
        if (generation !== outgoing.generation) return;
        if (!this.channel) throw new Error("Transfer DataChannel is missing.");
        await waitForTransferCapacity(this.channel, controller.signal);
        const end = Math.min(sentBytes + TRANSFER_CHUNK_SIZE, file.size);
        const bytes = new Uint8Array(await file.slice(sentBytes, end).arrayBuffer());
        hasher.update(bytes);
        const chunkFrame = encodeTransferChunk({ transferId: id, chunkIndex: index, data: bytes });
        this.sendEncryptedBinary(chunkFrame);
        chunkFrame.fill(0);
        bytes.fill(0);
        sentBytes = end;
        index += 1;
        outgoing.sentBytes = sentBytes;
        outgoing.nextChunk = index;
        const now = performance.now();
        if (now - lastProgressAt >= 100 || sentBytes === file.size) {
          this.updateTransfer(id, { bytesTransferred: sentBytes });
          lastProgressAt = now;
        }
      }

      this.sendEncryptedControl({
        type: "file-complete",
        id,
        chunks: chunkCount(file.size),
        sha256: hasher.digestHex(),
      });
      this.updateTransfer(id, {
        status: "completed",
        bytesTransferred: file.size,
        integrity: "pending",
      });
      this.outgoingFiles.delete(id);
    } finally {
      outgoing.transmitting = false;
    }
  }

  private receiveTransferChunk(chunk: {
    transferId: string;
    chunkIndex: number;
    data: Uint8Array;
  }): void {
    const incoming = this.incomingFiles.get(chunk.transferId);
    const transferStatus = this.transferById(chunk.transferId)?.status;
    if (!incoming || (transferStatus !== "transferring" && transferStatus !== "paused")) {
      throw new Error("Received a chunk for an unaccepted transfer.");
    }
    if (chunk.chunkIndex !== incoming.nextChunk) throw new Error("Transfer chunk is out of order.");
    if (incoming.receivedBytes + chunk.data.length > incoming.offer.size) {
      throw new Error("Transfer exceeds its offered size.");
    }
    incoming.hasher.update(chunk.data);
    // decodeTransferChunk already detached this data from the decrypted frame.
    incoming.chunks.push(chunk.data);
    incoming.receivedBytes += chunk.data.length;
    incoming.nextChunk += 1;
    const now = performance.now();
    if (now - incoming.lastProgressAt >= 100 || incoming.receivedBytes === incoming.offer.size) {
      this.updateTransfer(chunk.transferId, { bytesTransferred: incoming.receivedBytes });
      incoming.lastProgressAt = now;
    }
  }

  private completeIncomingTransfer(
    message: Extract<TransferControlMessage, { type: "file-complete" }>,
  ): void {
    const incoming = this.incomingFiles.get(message.id);
    if (!incoming || this.transferById(message.id)?.status !== "transferring") {
      throw new Error("Received completion for an inactive transfer.");
    }
    const digest = incoming.hasher.digestHex();
    const valid =
      incoming.receivedBytes === incoming.offer.size &&
      incoming.nextChunk === message.chunks &&
      digest === message.sha256;
    if (!valid) {
      this.incomingFiles.delete(message.id);
      this.updateTransfer(message.id, {
        status: "failed",
        integrity: "failed",
        error: "File integrity verification failed.",
      });
      return;
    }

    const blob = new Blob(incoming.chunks.map(toArrayBuffer), {
      type: incoming.offer.mime || "application/octet-stream",
    });
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrls.add(objectUrl);
    this.incomingFiles.delete(message.id);
    this.updateTransfer(message.id, {
      status: "completed",
      bytesTransferred: incoming.offer.size,
      integrity: "verified",
      objectUrl,
    });
    this.sendEncryptedControl({ type: "file-verified", id: message.id, sha256: digest });
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
    if (this.connectionInterrupted) {
      this.connectionInterrupted = false;
      for (const [id, outgoing] of this.outgoingFiles) {
        if (!outgoing.accepted) continue;
        this.sendEncryptedControl({
          type: "file-resume-offer",
          id,
          size: outgoing.file.size,
          nextChunk: outgoing.nextChunk,
          byteOffset: outgoing.sentBytes,
        });
      }
    }
  }

  private sendEncryptedControl(message: ApplicationMessage): void {
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

  private sendEncryptedBinary(plaintext: Uint8Array): void {
    if (!this.channel || this.channel.readyState !== "open" || !this.applicationCipher) {
      throw new Error("Application encryption is not active.");
    }
    const encrypted = this.applicationCipher.encrypt(plaintext);
    const frame = encodeEncryptedBinaryFrame(encrypted.counter, encrypted.ciphertext);
    this.channel.send(toArrayBuffer(frame));
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

  private appendTransfer(transfer: TransferEntry): void {
    this.update({ transfers: [...this.state.transfers, transfer] });
  }

  private transferById(id: string): TransferEntry | undefined {
    return this.state.transfers.find((transfer) => transfer.id === id);
  }

  private updateTransfer(id: string, patch: Partial<TransferEntry>): void {
    this.update({
      transfers: this.state.transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, ...patch } : transfer,
      ),
    });
  }

  private trySendTransferCancel(id: string, reason: string): void {
    try {
      this.sendEncryptedControl({ type: "file-cancel", id, reason });
    } catch {
      // The peer connection may already be gone; local state still records the failure.
    }
  }

  private resetPeerConnection(preserveTransfers = false): void {
    this.pendingCandidates = [];
    this.seenChatMessageIds.clear();
    this.authenticationAttempted = false;
    if (preserveTransfers) {
      for (const [id, outgoing] of this.outgoingFiles) {
        if (!outgoing.accepted) {
          outgoing.controller.abort();
          this.outgoingFiles.delete(id);
          continue;
        }
        outgoing.generation += 1;
        outgoing.paused = true;
        outgoing.resume?.();
        outgoing.resume = null;
      }
      for (const [id] of this.incomingFiles) {
        if (this.transferById(id)?.status === "offered") this.incomingFiles.delete(id);
      }
    } else {
      for (const outgoing of this.outgoingFiles.values()) outgoing.controller.abort();
      this.outgoingFiles.clear();
      this.incomingFiles.clear();
      for (const objectUrl of this.objectUrls) URL.revokeObjectURL(objectUrl);
      this.objectUrls.clear();
    }
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
    const preservedState = preserveTransfers
      ? {
          messages: this.state.messages,
          transfers: this.state.transfers.map((transfer) =>
            transfer.status === "waiting" || transfer.status === "offered"
              ? {
                  ...transfer,
                  status: "cancelled" as const,
                  error: "Offer ended when the connection changed.",
                }
              : transfer.status === "transferring"
                ? { ...transfer, status: "paused" as const, error: "Waiting to reconnect." }
                : transfer,
          ),
        }
      : { messages: [], transfers: [] };
    this.update({
      peerConnection: "closed",
      dataChannel: "none",
      connectionPath: "unknown",
      authentication: "waiting-for-peer",
      authError: null,
      ...preservedState,
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

function encodeEncryptedBinaryFrame(counterValue: string, ciphertext: Uint8Array): Uint8Array {
  const counter = BigInt(counterValue);
  const frame = new Uint8Array(12 + ciphertext.length);
  frame.set([0x50, 0x4c, 0x42, 0x01]);
  new DataView(frame.buffer).setBigUint64(4, counter, false);
  frame.set(ciphertext, 12);
  return frame;
}

function decodeEncryptedBinaryFrame(frame: Uint8Array): {
  counter: string;
  ciphertext: Uint8Array;
} {
  if (
    frame.length < 28 ||
    frame[0] !== 0x50 ||
    frame[1] !== 0x4c ||
    frame[2] !== 0x42 ||
    frame[3] !== 0x01
  ) {
    throw new Error("The peer sent an invalid encrypted binary frame.");
  }
  return {
    counter: new DataView(frame.buffer, frame.byteOffset + 4, 8)
      .getBigUint64(0, false)
      .toString(10),
    ciphertext: frame.slice(12),
  };
}

function isSupportedImage(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function getSafeRelativePath(file: File): { relativePath: string } | Record<string, never> {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (
    !relativePath ||
    relativePath.length > 1_024 ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    hasControlCharacters(relativePath)
  ) {
    return {};
  }
  return { relativePath };
}

function waitUntilResumed(outgoing: OutgoingTransfer): Promise<void> {
  if (!outgoing.paused) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      outgoing.resume = null;
      reject(new DOMException("Transfer cancelled.", "AbortError"));
    };
    outgoing.controller.signal.addEventListener("abort", abort, { once: true });
    outgoing.resume = () => {
      outgoing.controller.signal.removeEventListener("abort", abort);
      resolve();
    };
  });
}

async function hashFilePrefix(
  file: File,
  byteOffset: number,
  signal: AbortSignal,
): Promise<TransferHasher> {
  const hasher = new TransferHasher();
  for (let offset = 0; offset < byteOffset; offset += TRANSFER_CHUNK_SIZE) {
    if (signal.aborted) throw new DOMException("Transfer cancelled.", "AbortError");
    const end = Math.min(offset + TRANSFER_CHUNK_SIZE, byteOffset);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    hasher.update(bytes);
    bytes.fill(0);
  }
  return hasher;
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
