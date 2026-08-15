import {
  CHAT_MESSAGE_MAX_LENGTH,
  PRODUCT_NAME,
  type ChatMessage,
  type ServiceHealth,
} from "@peerlink/protocol";
import { type FormEvent, useEffect, useState } from "react";

import type { ChatEntry } from "./webrtc/PeerRoomSession";

import { createRoom, getRoomIdFromPath } from "./api";
import { SIGNALING_URL } from "./config";
import { usePeerRoom } from "./webrtc/usePeerRoom";

type HealthState = "checking" | "connected" | "unavailable";

export function App() {
  const [roomId, setRoomId] = useState(() => getRoomIdFromPath(window.location.pathname));

  useEffect(() => {
    const handleNavigation = () => setRoomId(getRoomIdFromPath(window.location.pathname));
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setRoomId(getRoomIdFromPath(path));
  }

  return roomId ? (
    <RoomPage roomId={roomId} onLeave={() => navigate("/")} />
  ) : (
    <LandingPage onRoomCreated={(path) => navigate(path)} />
  );
}

function LandingPage({ onRoomCreated }: { onRoomCreated: (path: string) => void }) {
  const [health, setHealth] = useState<HealthState>("checking");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function checkHealth() {
      try {
        const response = await fetch(`${SIGNALING_URL}/health`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
        const result: unknown = await response.json();
        setHealth(isHealthy(result) ? "connected" : "unavailable");
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setHealth("unavailable");
        }
      }
    }
    void checkHealth();
    return () => controller.abort();
  }, []);

  async function handleCreateRoom() {
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom();
      onRoomCreated(room.roomPath);
    } catch {
      setError("Could not create a room. Check that the signaling service is running.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageShell>
      <div className="grid flex-1 items-center gap-14 py-20 lg:grid-cols-[1.25fr_0.75fr]">
        <div>
          <p className="mb-5 text-sm font-medium uppercase tracking-[0.28em] text-cyan-300">
            Private by architecture
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-balance sm:text-7xl">
            A room for two. Nothing left behind.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
            Create an unguessable room, share its link, and establish a direct browser-to-browser
            connection for private text chat.
          </p>
          <button
            className="mt-10 rounded-2xl bg-cyan-300 px-6 py-3.5 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
            disabled={creating || health === "unavailable"}
            onClick={() => void handleCreateRoom()}
            type="button"
          >
            {creating ? "Creating room…" : "Create private room"}
          </button>
          {error ? (
            <p className="mt-4 text-sm text-rose-300" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <aside className="glass-card rounded-3xl p-6 sm:p-8" aria-label="Service status">
          <p className="text-sm font-medium text-slate-400">Phase 2 status</p>
          <h2 className="mt-2 text-2xl font-semibold">Direct text chat</h2>
          <dl className="mt-8 space-y-5 text-sm">
            <StatusRow label="Signaling service" value={healthLabel(health)} state={health} />
            <StatusRow label="Room capacity" value="Two peers" />
            <StatusRow label="Connection path" value="WebRTC DataChannel" />
            <StatusRow label="Message validation" value="Enabled" />
            <StatusRow label="Content stored on server" value="None" />
          </dl>
        </aside>
      </div>
    </PageShell>
  );
}

function RoomPage({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const state = usePeerRoom(roomId);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const inviteUrl = `${window.location.origin}/r/${roomId}`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = state.sendChatMessage(draft);
    if (!result.ok) {
      setSendError(result.error);
      return;
    }
    setDraft("");
    setSendError(null);
  }

  return (
    <PageShell>
      <div className="flex flex-1 py-12">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="glass-card rounded-3xl p-7 sm:p-10">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-300">
                Private room
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                {roomStatusTitle(state.phase)}
              </h1>
              <p className="mt-4 leading-7 text-slate-300">{roomStatusDescription(state.phase)}</p>

              <div className="mt-8 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Invite link
                </p>
                <p className="mt-2 truncate font-mono text-sm text-slate-200">{inviteUrl}</p>
                <button
                  className="mt-4 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-300/15"
                  onClick={() => void copyInvite()}
                  type="button"
                >
                  {copied ? "Copied" : "Copy invite link"}
                </button>
              </div>

              {state.error ? (
                <p className="mt-5 text-sm text-rose-300" role="alert">
                  {state.error}
                </p>
              ) : null}
            </section>

            <aside className="glass-card rounded-3xl p-7" aria-label="Connection status">
              <p className="text-sm font-medium text-slate-400">Connection status</p>
              <dl className="mt-7 space-y-5 text-sm">
                <ConnectionRow
                  label="Signaling"
                  connected={state.role !== null}
                  value={state.role ? "Connected" : "Connecting"}
                />
                <ConnectionRow
                  label="Room role"
                  connected={state.role !== null}
                  value={state.role ?? "Assigning"}
                />
                <ConnectionRow
                  label="Peer"
                  connected={state.peerConnection === "connected"}
                  value={
                    state.peerConnection === "connected"
                      ? "Peer connected"
                      : formatState(state.peerConnection)
                  }
                />
                <ConnectionRow
                  label="Control channel"
                  connected={state.dataChannel === "open"}
                  value={
                    state.dataChannel === "open"
                      ? "DataChannel open"
                      : formatState(state.dataChannel)
                  }
                />
                <ConnectionRow label="STUN" connected value="Cloudflare" />
              </dl>
              <button
                className="mt-8 text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200"
                onClick={onLeave}
                type="button"
              >
                Leave room
              </button>
            </aside>
          </div>

          <section className="glass-card overflow-hidden rounded-3xl" aria-label="Direct chat">
            <div className="border-b border-white/10 px-6 py-5 sm:px-8">
              <p className="text-sm font-medium text-slate-400">Direct chat</p>
              <h2 className="mt-1 text-xl font-semibold">Messages stay between these browsers</h2>
            </div>

            <ol
              aria-label="Messages"
              aria-live="polite"
              className="flex min-h-64 max-h-[28rem] flex-col gap-4 overflow-y-auto px-6 py-6 sm:px-8"
            >
              {state.messages.length === 0 ? (
                <li className="m-auto max-w-md text-center text-sm leading-6 text-slate-400">
                  {state.dataChannel === "open"
                    ? "You are connected. Send the first message."
                    : "Chat unlocks when the control DataChannel opens."}
                </li>
              ) : (
                state.messages.map((message) => <ChatBubble key={message.id} message={message} />)
              )}
            </ol>

            <form
              className="border-t border-white/10 bg-slate-950/35 p-4 sm:p-6"
              onSubmit={sendMessage}
            >
              <div className="flex gap-3">
                <label className="sr-only" htmlFor="chat-message">
                  Message
                </label>
                <input
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={state.dataChannel !== "open"}
                  id="chat-message"
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setSendError(null);
                  }}
                  placeholder="Write a message…"
                  value={draft}
                />
                <button
                  className="rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={state.dataChannel !== "open" || draft.trim().length === 0}
                  type="submit"
                >
                  Send
                </button>
              </div>
              {sendError || state.chatError ? (
                <p className="mt-3 text-sm text-rose-300" role="alert">
                  {sendError ?? state.chatError}
                </p>
              ) : null}
            </form>
          </section>
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <section className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-16">
        <header className="flex items-center justify-between">
          <a className="flex items-center gap-3 font-semibold tracking-tight" href="/">
            <span className="grid size-9 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              P
            </span>
            {PRODUCT_NAME}
          </a>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            Phase 2
          </span>
        </header>
        {children}
        <footer className="text-sm text-slate-500">
          The link finds the room. WebRTC carries the data.
        </footer>
      </section>
    </main>
  );
}

function ChatBubble({ message }: { message: ChatEntry }) {
  const outgoing = message.direction === "outgoing";

  return (
    <li
      className={`flex ${outgoing ? "justify-end" : "justify-start"}`}
      data-message-id={message.id}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[70%] ${
          outgoing
            ? "rounded-br-md bg-cyan-300 text-slate-950"
            : "rounded-bl-md border border-white/10 bg-white/8 text-slate-100"
        }`}
      >
        <div className="flex items-center justify-between gap-5 text-xs opacity-70">
          <span>{outgoing ? "You" : "Peer"}</span>
          <time dateTime={new Date(message.timestamp).toISOString()}>
            {formatChatTime(message)}
          </time>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
      </div>
    </li>
  );
}

function formatChatTime(message: ChatMessage): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(message.timestamp);
}

function StatusRow({ label, value, state }: { label: string; value: string; state?: HealthState }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-5 last:border-0 last:pb-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="flex items-center gap-2 font-medium text-slate-100">
        {state ? (
          <StatusDot active={state === "connected"} warning={state === "unavailable"} />
        ) : null}
        {value}
      </dd>
    </div>
  );
}

function ConnectionRow({
  label,
  value,
  connected,
}: {
  label: string;
  value: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-5 last:border-0 last:pb-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-medium">
        <StatusDot active={connected} />
        {value}
      </dd>
    </div>
  );
}

function StatusDot({ active, warning = false }: { active: boolean; warning?: boolean }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${warning ? "bg-rose-400" : active ? "bg-emerald-400" : "animate-pulse bg-cyan-300"}`}
      aria-hidden="true"
    />
  );
}

function healthLabel(health: HealthState): string {
  if (health === "checking") return "Checking…";
  return health === "connected" ? "Connected" : "Unavailable";
}

function isHealthy(value: unknown): value is ServiceHealth {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "product" in value &&
    value.status === "ok" &&
    value.product === PRODUCT_NAME
  );
}

function roomStatusTitle(phase: string): string {
  if (phase === "connected") return "Connected";
  if (phase === "waiting") return "Waiting for your peer";
  if (phase === "negotiating") return "Connecting peer…";
  if (phase === "error") return "Connection failed";
  if (phase === "disconnected") return "Peer disconnected";
  return "Opening room…";
}

function roomStatusDescription(phase: string): string {
  if (phase === "connected") return "Peer connected and the control DataChannel is open.";
  if (phase === "waiting")
    return "Share the invite link with one other person and keep this page open.";
  if (phase === "negotiating") return "Exchanging connection details through the signaling Worker.";
  if (phase === "error") return "The room may be full, unavailable, or blocked by this network.";
  if (phase === "disconnected") return "The peer or signaling connection closed.";
  return "Connecting securely to the signaling service.";
}

function formatState(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
