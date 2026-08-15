import { SELF, env, evictDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ClientSignalingMessage,
  RoomCreated,
  ServerSignalingMessage,
  ServiceHealth,
} from "@peerlink/protocol";
import { isServerSignalingMessage } from "@peerlink/protocol";
import { createTurnCredentials } from "../src/worker";

const appOrigin = "https://peerlink.shubhamsaraf.dev";
const openSockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of openSockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Test complete");
  }
});

describe("PeerLink signaling Worker", () => {
  it("reports service health", async () => {
    const response = await SELF.fetch("https://signaling.example/health");
    const body = await response.json<ServiceHealth>();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      service: "signaling",
      product: "PeerLink",
      protocolVersion: 1,
    });
  });

  it("creates cryptographically shaped room identifiers", async () => {
    const first = await createRoom();
    const second = await createRoom();

    expect(first.roomId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.roomPath).toBe(`/r/${first.roomId}`);
    expect(second.roomId).not.toBe(first.roomId);
  });

  it("rejects room creation from an unknown browser origin", async () => {
    const response = await SELF.fetch("https://signaling.example/api/rooms", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.status).toBe(403);
  });

  it("keeps TURN disabled when its Worker secret is absent", async () => {
    const response = await SELF.fetch("https://signaling.example/api/turn-credentials", {
      headers: { Origin: appOrigin },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("mints short-lived coturn REST credentials", async () => {
    const now = 1_900_000_000_000;
    const credentials = await createTurnCredentials(
      {
        TURN_HOST: "turn.example.com",
        TURN_CREDENTIAL_TTL_SECONDS: "3600",
        TURN_SHARED_SECRET: "test-only-shared-secret",
      },
      now,
    );
    expect(credentials.expiresAt).toBe(now + 3_600_000);
    expect(credentials.iceServers[0]?.urls).toContain("turn:turn.example.com:3478?transport=udp");
    expect(credentials.iceServers[0]?.username).toMatch(/^1900003600:/);
    expect(credentials.iceServers[0]?.credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("connects two peers, forwards signals, and rejects a third", async () => {
    const { roomId } = await createRoom();
    const first = await connect(roomId);
    expect(await nextMessage(first)).toEqual({
      type: "room-joined",
      role: "initiator",
      peerCount: 1,
    });

    const firstSawJoin = nextMessage(first);
    const second = await connect(roomId);
    expect(await nextMessage(second)).toEqual({
      type: "room-joined",
      role: "responder",
      peerCount: 2,
    });
    expect(await firstSawJoin).toEqual({ type: "peer-joined" });

    const offer: ClientSignalingMessage = { type: "offer", sdp: "v=0\r\n" };
    const forwardedOffer = nextMessage(second);
    first.send(JSON.stringify(offer));
    expect(await forwardedOffer).toEqual(offer);

    const rejectedChat = nextMessage(first);
    first.send(
      JSON.stringify({
        type: "chat",
        id: "9f23ce7e-1821-4b74-b60a-0d8185631d99",
        timestamp: 1_723_456_789_000,
        text: "This must not pass through signaling",
      }),
    );
    expect(await rejectedChat).toEqual({
      type: "error",
      code: "invalid-signal",
      message: "Invalid signaling message.",
    });

    const rejectedPake = nextMessage(first);
    first.send(
      JSON.stringify({
        type: "pake-share",
        version: 1,
        sessionId: "A".repeat(43),
        share: "B".repeat(43),
      }),
    );
    expect(await rejectedPake).toEqual({
      type: "error",
      code: "invalid-signal",
      message: "Invalid signaling message.",
    });

    const thirdResponse = await SELF.fetch(roomSocketUrl(roomId), {
      headers: { Upgrade: "websocket", Origin: appOrigin },
    });
    expect(thirdResponse.status).toBe(409);
  });

  it("keeps signaling sockets usable across Durable Object eviction", async () => {
    const { roomId } = await createRoom();
    const first = await connect(roomId);
    await nextMessage(first);
    const firstSawJoin = nextMessage(first);
    const second = await connect(roomId);
    await nextMessage(second);
    await firstSawJoin;

    await evictDurableObject(env.ROOMS.getByName(roomId));

    const candidate: ClientSignalingMessage = {
      type: "ice-candidate",
      candidate: "candidate:1 1 UDP 1 127.0.0.1 9999 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: null,
    };
    const forwardedCandidate = nextMessage(second);
    first.send(JSON.stringify(candidate));
    expect(await forwardedCandidate).toEqual(candidate);
  });
});

async function createRoom(): Promise<RoomCreated> {
  const response = await SELF.fetch("https://signaling.example/api/rooms", {
    method: "POST",
    headers: { Origin: appOrigin },
  });
  expect(response.status).toBe(201);
  return response.json<RoomCreated>();
}

async function connect(roomId: string): Promise<WebSocket> {
  const response = await SELF.fetch(roomSocketUrl(roomId), {
    headers: { Upgrade: "websocket", Origin: appOrigin },
  });
  expect(response.status).toBe(101);

  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket upgrade response");
  socket.accept();
  openSockets.push(socket);
  return socket;
}

function roomSocketUrl(roomId: string): string {
  return `https://signaling.example/api/rooms/${roomId}/socket`;
}

function nextMessage(socket: WebSocket): Promise<ServerSignalingMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message")),
      2_000,
    );
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        const value: unknown = JSON.parse(String(event.data));
        if (isServerSignalingMessage(value)) resolve(value);
        else reject(new Error("Received an invalid server signaling message"));
      },
      { once: true },
    );
  });
}
