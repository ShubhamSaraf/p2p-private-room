export class Room {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" || url.pathname !== "/health") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json({
      status: "ready",
      storage: "none",
    });
  }
}
