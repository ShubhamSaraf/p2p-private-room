import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("shows the Phase 0 foundation and a healthy signaling service", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          service: "signaling",
          product: "PeerLink",
          protocolVersion: 1,
        }),
        { status: 200 },
      ),
    );

    render(<App />);

    expect(screen.getByRole("heading", { name: /a room for two/i })).toBeInTheDocument();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});
