import {
  PRODUCT_NAME,
  SIGNALING_PROTOCOL_VERSION,
  type RoomCreated,
  type ServiceHealth,
  isRoomId,
} from "@peerlink/protocol";

export { Room } from "./room";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
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

async function routeRequest(request: Request, env: Env): Promise<Response> {
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
    const room: RoomCreated = { roomId, roomPath: `/r/${roomId}` };
    return json(room, 201, corsHeaders);
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
