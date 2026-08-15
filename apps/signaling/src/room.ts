import {
  type ClientSignalingMessage,
  type PeerRole,
  type ServerSignalingMessage,
  isClientSignalingMessage,
} from "@peerlink/protocol";
import { DurableObject } from "cloudflare:workers";

const MAX_SIGNAL_FRAME_BYTES = 128 * 1024;
export const ROOM_RECONNECT_GRACE_MS = 5 * 60 * 1_000;
export const ROOM_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;

type SocketAttachment = {
  peerId: string;
  role: PeerRole;
};

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => Promise.resolve(this.migrate()));
  }

  async initialize(createdAt: number): Promise<void> {
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0)
      throw new Error("Invalid creation time");
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO room_lifecycle (singleton, created_at, expired) VALUES (1, ?, 0)",
      createdAt,
    );
    const lifecycle = this.getLifecycle();
    if (lifecycle && lifecycle.expired === 0) {
      await this.ctx.storage.setAlarm(lifecycle.created_at + ROOM_MAX_LIFETIME_MS);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "Expected a WebSocket upgrade" }, { status: 426 });
    }

    const now = Date.now();
    if (!this.getLifecycle()) await this.initialize(now);
    const lifecycle = this.getLifecycle();
    if (
      !lifecycle ||
      lifecycle.expired === 1 ||
      now >= lifecycle.created_at + ROOM_MAX_LIFETIME_MS
    ) {
      this.expireRoom();
      return Response.json({ error: "Room expired", code: "room-expired" }, { status: 410 });
    }

    const existingSockets = this.getOpenSockets();
    if (existingSockets.length >= 2) {
      return Response.json({ error: "Room is full", code: "room-full" }, { status: 409 });
    }

    const existingRole = getSocketAttachment(existingSockets[0])?.role;
    const role: PeerRole = existingRole === "initiator" ? "responder" : "initiator";
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({ peerId: crypto.randomUUID(), role } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [role]);
    await this.scheduleLifecycleAlarm(true, now);

    send(server, {
      type: "room-joined",
      role,
      peerCount: existingSockets.length === 0 ? 1 : 2,
    });

    for (const socket of existingSockets) {
      send(socket, { type: "peer-joined" });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer): void {
    if (typeof frame !== "string") {
      sendError(socket, "unsupported-frame", "Signaling frames must be JSON text.");
      return;
    }

    if (new TextEncoder().encode(frame).byteLength > MAX_SIGNAL_FRAME_BYTES) {
      sendError(socket, "frame-too-large", "Signaling frame is too large.");
      socket.close(1009, "Signaling frame too large");
      return;
    }

    const message = parseClientMessage(frame);
    if (!message) {
      sendError(socket, "invalid-signal", "Invalid signaling message.");
      return;
    }

    const attachment = getSocketAttachment(socket);
    if (!attachment) {
      sendError(socket, "invalid-session", "Peer session metadata is unavailable.");
      socket.close(1011, "Missing peer metadata");
      return;
    }

    if (
      (message.type === "offer" && attachment.role !== "initiator") ||
      (message.type === "answer" && attachment.role !== "responder")
    ) {
      sendError(socket, "invalid-role", `The ${attachment.role} cannot send ${message.type}.`);
      return;
    }

    const peers = this.getOpenSockets().filter((peer) => peer !== socket);
    if (peers.length === 0) {
      sendError(socket, "peer-unavailable", "The other peer is not connected.");
      return;
    }

    const encodedMessage = JSON.stringify(message);
    for (const peer of peers) {
      peer.send(encodedMessage);
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
    this.notifyRemainingPeer();
    await this.scheduleLifecycleAlarm(this.getOpenSockets().length > 0);
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    console.error(
      JSON.stringify({
        event: "room-websocket-error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    socket.close(1011, "WebSocket error");
    this.notifyRemainingPeer();
    await this.scheduleLifecycleAlarm(this.getOpenSockets().length > 0);
  }

  async alarm(): Promise<void> {
    const lifecycle = this.getLifecycle();
    if (!lifecycle || lifecycle.expired === 1) return;
    const now = Date.now();
    if (now >= lifecycle.created_at + ROOM_MAX_LIFETIME_MS || this.getOpenSockets().length === 0) {
      this.expireRoom();
      return;
    }
    await this.scheduleLifecycleAlarm(true, now);
  }

  private getOpenSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private notifyRemainingPeer(): void {
    for (const peer of this.getOpenSockets()) {
      send(peer, { type: "peer-left" });
    }
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_lifecycle (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        created_at INTEGER NOT NULL,
        expired INTEGER NOT NULL DEFAULT 0 CHECK (expired IN (0, 1))
      )
    `);
  }

  private getLifecycle(): { created_at: number; expired: number } | null {
    return (
      this.ctx.storage.sql
        .exec<{ created_at: number; expired: number }>(
          "SELECT created_at, expired FROM room_lifecycle WHERE singleton = 1",
        )
        .toArray()[0] ?? null
    );
  }

  private async scheduleLifecycleAlarm(hasConnectedPeer: boolean, now = Date.now()): Promise<void> {
    const lifecycle = this.getLifecycle();
    if (!lifecycle || lifecycle.expired === 1) return;
    const maximum = lifecycle.created_at + ROOM_MAX_LIFETIME_MS;
    const next = hasConnectedPeer ? maximum : Math.min(maximum, now + ROOM_RECONNECT_GRACE_MS);
    await this.ctx.storage.setAlarm(next);
  }

  private expireRoom(): void {
    this.ctx.storage.sql.exec("UPDATE room_lifecycle SET expired = 1 WHERE singleton = 1");
    for (const socket of this.getOpenSockets()) socket.close(1000, "Room expired");
  }
}

function parseClientMessage(frame: string): ClientSignalingMessage | null {
  try {
    const value: unknown = JSON.parse(frame);
    return isClientSignalingMessage(value) ? value : null;
  } catch {
    return null;
  }
}

function getSocketAttachment(socket: WebSocket | undefined): SocketAttachment | null {
  if (!socket) return null;
  const value: unknown = socket.deserializeAttachment();

  if (
    typeof value !== "object" ||
    value === null ||
    !("peerId" in value) ||
    !("role" in value) ||
    typeof value.peerId !== "string" ||
    (value.role !== "initiator" && value.role !== "responder")
  ) {
    return null;
  }

  return { peerId: value.peerId, role: value.role };
}

function send(socket: WebSocket, message: ServerSignalingMessage): void {
  socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, code: string, message: string): void {
  send(socket, { type: "error", code, message });
}
