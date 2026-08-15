import {
  PRODUCT_NAME,
  SIGNALING_PROTOCOL_VERSION,
  type RoomCreated,
  type ServiceHealth,
  type TurnCredentials,
  isRoomId,
} from "@peerlink/protocol";

export { Room } from "./room";

type WorkerEnv = Env & { TURN_SHARED_SECRET?: string };

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    return await routeRequest(request, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "worker-request-error",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ error: "Internal server error" }, 500, createCorsHeaders(request, env));
  }
}

async function routeRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = createCorsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const health: ServiceHealth = {
      status: "ok",
      service: "signaling",
      product: PRODUCT_NAME,
      protocolVersion: SIGNALING_PROTOCOL_VERSION,
    };
    return json(health, 200, corsHeaders);
  }

  if (request.method === "GET" && url.pathname === "/") {
    return json(
      {
        product: PRODUCT_NAME,
        service: "signaling",
        phase: 1,
        storesUserContent: false,
      },
      200,
      corsHeaders,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    if (!isRequestOriginAllowed(request, env)) {
      return json({ error: "Origin is not allowed" }, 403, corsHeaders);
    }

    const roomId = createRoomId();
    await env.ROOMS.getByName(roomId).initialize(Date.now());
    const room: RoomCreated = { roomId, roomPath: `/r/${roomId}` };
    return json(room, 201, corsHeaders);
  }

  if (request.method === "GET" && url.pathname === "/api/turn-credentials") {
    if (!isRequestOriginAllowed(request, env)) {
      return json({ error: "Origin is not allowed" }, 403, corsHeaders);
    }
    if (!env.TURN_SHARED_SECRET) {
      return json({ error: "TURN is not configured" }, 503, corsHeaders);
    }
    return json(await createTurnCredentials(env), 200, corsHeaders);
  }

  const socketMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
  if (request.method === "GET" && socketMatch) {
    const roomId = socketMatch[1];
    if (!roomId || !isRoomId(roomId)) {
      return json({ error: "Invalid room ID" }, 400, corsHeaders);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade" }, 426, corsHeaders);
    }
    if (!isRequestOriginAllowed(request, env)) {
      return json({ error: "Origin is not allowed" }, 403, corsHeaders);
    }

    return env.ROOMS.getByName(roomId).fetch(request);
  }

  return json({ error: "Not found" }, 404, corsHeaders);
}

export function createRoomId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function createTurnCredentials(
  env: {
    TURN_HOST: string;
    TURN_CREDENTIAL_TTL_SECONDS: string;
    TURN_SHARED_SECRET?: string;
  },
  now = Date.now(),
): Promise<TurnCredentials> {
  if (!env.TURN_SHARED_SECRET) throw new Error("TURN shared secret is not configured");
  const ttlSeconds = Number.parseInt(env.TURN_CREDENTIAL_TTL_SECONDS, 10);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error("TURN credential TTL must be between 60 and 86400 seconds");
  }
  if (!/^[a-z0-9.-]+$/i.test(env.TURN_HOST)) throw new Error("TURN host is invalid");

  const expiresAt = now + ttlSeconds * 1_000;
  const username = `${Math.floor(expiresAt / 1_000)}:${crypto.randomUUID()}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TURN_SHARED_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
  const credential = bytesToBase64(new Uint8Array(signature));

  return {
    iceServers: [
      {
        urls: [
          `turn:${env.TURN_HOST}:3478?transport=udp`,
          `turn:${env.TURN_HOST}:3478?transport=tcp`,
          `turns:${env.TURN_HOST}:5349?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
    expiresAt,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function isRequestOriginAllowed(request: Request, env: Pick<Env, "APP_ORIGIN">): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  if (origin === env.APP_ORIGIN) return true;

  const requestHostname = new URL(request.url).hostname;
  const isLocalWorker = requestHostname === "localhost" || requestHostname === "127.0.0.1";
  const isLocalFrontend = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  return isLocalWorker && isLocalFrontend;
}

export function createCorsHeaders(request: Request, env: Pick<Env, "APP_ORIGIN">): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");

  if (isRequestOriginAllowed(request, env)) {
    headers.set("Access-Control-Allow-Origin", origin ?? env.APP_ORIGIN);
  }

  return headers;
}

function json(data: unknown, status: number, extraHeaders: Headers): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers });
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
