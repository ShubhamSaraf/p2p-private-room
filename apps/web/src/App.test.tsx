import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const {
  acceptTransfer,
  cancelTransfer,
  declineTransfer,
  offerFile,
  roomOverrides,
  sendChatMessage,
  startAuthentication,
} = vi.hoisted(() => ({
  acceptTransfer: vi.fn(() => ({ ok: true as const })),
  cancelTransfer: vi.fn(() => ({ ok: true as const })),
  declineTransfer: vi.fn(() => ({ ok: true as const })),
  offerFile: vi.fn(() => ({ ok: true as const })),
  roomOverrides: {} as Record<string, unknown>,
  sendChatMessage: vi.fn(() => ({ ok: true as const })),
  startAuthentication: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("./webrtc/usePeerRoom", () => ({
  usePeerRoom: () => ({
    phase: "connected",
    role: "initiator",
    peerConnection: "connected",
    dataChannel: "open",
    connectionPath: "direct",
    turnAvailability: "available",
    connectionStartedAt: 1_723_456_780_000,
    connectedAt: 1_723_456_781_250,
    authentication: "verified",
    authError: null,
    messages: [
      {
        type: "chat",
        id: "9f23ce7e-1821-4b74-b60a-0d8185631d99",
        timestamp: 1_723_456_789_000,
        text: "A message from the peer",
        direction: "incoming",
      },
    ],
    transfers: [],
    chatError: null,
    error: null,
    sendChatMessage,
    startAuthentication,
    offerFile,
    acceptTransfer,
    declineTransfer,
    cancelTransfer,
    ...roomOverrides,
  }),
}));

const roomId = "A7_k92LmPq4VX8nBz0RtUvWxY1234567";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sendChatMessage.mockClear();
  startAuthentication.mockClear();
  offerFile.mockClear();
  for (const key of Object.keys(roomOverrides)) delete roomOverrides[key];
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
    expect(screen.getByText("A message from the peer")).toBeInTheDocument();
  });

  it("submits chat text through the peer-room controller", () => {
    window.history.replaceState(null, "", `/r/${roomId}`);
    render(<App />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(sendChatMessage).toHaveBeenCalledWith("Hello there");
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("submits and clears the shared secret before chat is unlocked", async () => {
    Object.assign(roomOverrides, { authentication: "required", messages: [] });
    window.history.replaceState(null, "", `/r/${roomId}`);
    render(<App />);

    const input = screen.getByLabelText("Shared secret");
    fireEvent.change(input, { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() =>
      expect(startAuthentication).toHaveBeenCalledWith("correct horse battery staple"),
    );
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("copies content-free beta diagnostics", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    window.history.replaceState(null, "", `/r/${roomId}`);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Copy beta diagnostics" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const report = String(writeText.mock.calls[0]?.[0]);
    expect(report).toContain('"connectTimeMs": 1250');
    expect(report).not.toContain(roomId);
    expect(report).not.toContain("A message from the peer");
  });
});
