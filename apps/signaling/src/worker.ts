import { PRODUCT_NAME, SIGNALING_PROTOCOL_VERSION, type ServiceHealth } from "@peerlink/protocol";

import type { Env } from "./env";

export { Room } from "./room";

const roomIdPattern = /^[A-Za-z0-9_-]{8,64}$/;

export async function handleRequest(request: Request, env: Env): Promise<Response> {
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
        phase: 0,
        storesUserContent: false,
      },
      200,
      corsHeaders,
    );
  }

  const debugRoomMatch = url.pathname.match(/^\/debug\/rooms\/([^/]+)$/);
  if (request.method === "GET" && debugRoomMatch) {
    const roomId = debugRoomMatch[1];

    if (!roomId || !roomIdPattern.test(roomId)) {
      return json({ error: "Invalid room ID" }, 400, corsHeaders);
    }

    const objectId = env.ROOMS.idFromName(roomId);
    const room = env.ROOMS.get(objectId);
    const roomResponse = await room.fetch("https://room.internal/health");
    const durableObject: unknown = await roomResponse.json();

    return json({ roomId, durableObject }, roomResponse.status, corsHeaders);
  }

  return json({ error: "Not found" }, 404, corsHeaders);
}

export function createCorsHeaders(request: Request, env: Pick<Env, "APP_ORIGIN">): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  const requestHostname = new URL(request.url).hostname;
  const isLocalWorker = requestHostname === "localhost" || requestHostname === "127.0.0.1";
  const isLocalFrontend = origin ? /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) : false;

  if (!origin || origin === env.APP_ORIGIN || (isLocalWorker && isLocalFrontend)) {
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
