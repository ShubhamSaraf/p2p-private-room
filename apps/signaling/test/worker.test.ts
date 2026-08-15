import { SELF, env, evictDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ClientSignalingMessage,
  RoomCreated,
  ServerSignalingMessage,
  ServiceHealth,
} from "@peerlink/protocol";
import { isServerSignalingMessage } from "@peerlink/protocol";

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
