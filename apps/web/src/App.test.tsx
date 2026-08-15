import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

vi.mock("./webrtc/usePeerRoom", () => ({
  usePeerRoom: () => ({
    phase: "connected",
    role: "initiator",
    peerConnection: "connected",
    dataChannel: "open",
    error: null,
  }),
}));

const roomId = "A7_k92LmPq4VX8nBz0RtUvWxY1234567";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("creates a room and navigates to its invite route", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return Response.json({
          status: "ok",
          service: "signaling",
          product: "PeerLink",
          protocolVersion: 1,
        });
      }
      if (url.endsWith("/api/rooms") && init?.method === "POST") {
        return Response.json({ roomId, roomPath: `/r/${roomId}` }, { status: 201 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    });

    render(<App />);
    const createButton = screen.getByRole("button", { name: "Create private room" });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);

    expect(await screen.findByRole("heading", { name: "Connected" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/r/${roomId}`);
  });

  it("renders the peer and DataChannel status for an invite route", () => {
    window.history.replaceState(null, "", `/r/${roomId}`);

    render(<App />);

    expect(screen.getByText("Peer connected")).toBeInTheDocument();
    expect(screen.getByText("DataChannel open")).toBeInTheDocument();
    expect(screen.getByText("initiator")).toBeInTheDocument();
  });
});
