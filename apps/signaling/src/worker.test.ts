import { describe, expect, it } from "vitest";

import { createCorsHeaders } from "./worker";

describe("signaling CORS policy", () => {
  const env = { APP_ORIGIN: "https://peerlink.example" };

  it("allows the configured frontend origin", () => {
    const request = new Request("https://signaling.example/health", {
      headers: { Origin: env.APP_ORIGIN },
    });

    expect(createCorsHeaders(request, env).get("Access-Control-Allow-Origin")).toBe(env.APP_ORIGIN);
  });

  it("does not reflect an unknown origin", () => {
    const request = new Request("https://signaling.example/health", {
      headers: { Origin: "https://attacker.example" },
    });

    expect(createCorsHeaders(request, env).has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("allows a local frontend only when the Worker is also local", () => {
    const localRequest = new Request("http://127.0.0.1:8787/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    const deployedRequest = new Request("https://signaling.example/health", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(createCorsHeaders(localRequest, env).get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
    expect(createCorsHeaders(deployedRequest, env).has("Access-Control-Allow-Origin")).toBe(false);
  });
});
