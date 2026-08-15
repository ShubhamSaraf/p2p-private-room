import {
  CHAT_MESSAGE_MAX_LENGTH,
  PRODUCT_NAME,
  type ChatMessage,
  type ServiceHealth,
} from "@peerlink/protocol";
import { SHARED_SECRET_MAX_LENGTH, SHARED_SECRET_MIN_LENGTH } from "@peerlink/crypto";
import { isProbablyCompressed } from "@peerlink/transfer";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { ChatEntry, TransferEntry } from "./webrtc/PeerRoomSession";

import { createRoom, getRoomIdFromPath } from "./api";
import { SIGNALING_URL } from "./config";
import {
  clearLocalHistory,
  getLocalHistoryEnabled,
  loadRoomMessages,
  saveRoomMessages,
  setLocalHistoryEnabled,
} from "./localHistory";
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
            connection, verify a shared secret, and then unlock private text chat.
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
          <p className="text-sm font-medium text-slate-400">Phase 16 status</p>
          <h2 className="mt-2 text-2xl font-semibold">Installable, resilient sharing</h2>
          <dl className="mt-8 space-y-5 text-sm">
            <StatusRow label="Signaling service" value={healthLabel(health)} state={health} />
            <StatusRow label="Room capacity" value="Two peers" />
            <StatusRow label="Connection path" value="Direct WebRTC or TURN relay" />
            <StatusRow label="Message validation" value="Enabled" />
            <StatusRow label="Peer authentication" value="CPace PAKE (beta)" />
            <StatusRow label="Application encryption" value="AES-256-GCM" />
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
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [savedMessages, setSavedMessages] = useState<ChatEntry[]>([]);
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    category: "image" | "file";
  } | null>(null);
  const [pendingBatch, setPendingBatch] = useState<File[] | null>(null);
  const [compressedFile, setCompressedFile] = useState<File | null>(null);
  const [compressionProgress, setCompressionProgress] = useState<number | null>(null);
  const imagePickerRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const folderPickerRef = useRef<HTMLInputElement>(null);
  const compressionWorkerRef = useRef<Worker | null>(null);
  const inviteUrl = `${window.location.origin}/r/${roomId}`;
  const canShare = Reflect.has(navigator, "share");
  const activeTransfers = state.transfers.some(
    (transfer) =>
      transfer.status === "offered" ||
      transfer.status === "waiting" ||
      transfer.status === "transferring" ||
      transfer.status === "paused",
  );
  const transferTotalBytes = state.transfers.reduce((total, transfer) => total + transfer.size, 0);
  const transferredTotalBytes = state.transfers.reduce(
    (total, transfer) => total + transfer.bytesTransferred,
    0,
  );
  const visibleMessages = useMemo(() => {
    if (!historyEnabled) return state.messages;
    const messages = new Map(savedMessages.map((message) => [message.id, message]));
    for (const message of state.messages) messages.set(message.id, message);
    return [...messages.values()].sort((left, right) => left.timestamp - right.timestamp);
  }, [historyEnabled, savedMessages, state.messages]);

  useEffect(() => {
    let active = true;
    void getLocalHistoryEnabled().then(async (enabled) => {
      if (!active) return;
      setHistoryEnabled(enabled);
      if (enabled) setSavedMessages(await loadRoomMessages(roomId));
    });
    return () => {
      active = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (historyEnabled && state.messages.length > 0) {
      void saveRoomMessages(roomId, state.messages);
    }
  }, [historyEnabled, roomId, state.messages]);

  useEffect(() => {
    if (!activeTransfers) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [activeTransfers]);

  async function toggleLocalHistory(enabled: boolean) {
    setHistoryEnabled(enabled);
    await setLocalHistoryEnabled(enabled);
    if (enabled) {
      await saveRoomMessages(roomId, state.messages);
      setSavedMessages(await loadRoomMessages(roomId));
    } else {
      setSavedMessages([]);
    }
  }

  async function clearSavedHistory() {
    await clearLocalHistory();
    setSavedMessages([]);
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  async function toggleQrCode() {
    if (qrCodeUrl) {
      setQrCodeUrl(null);
      return;
    }
    setQrCodeUrl(
      await QRCode.toDataURL(inviteUrl, {
        width: 320,
        margin: 2,
        color: { dark: "#020617", light: "#ffffff" },
      }),
    );
  }

  async function shareInvite() {
    if (!canShare) return;
    try {
      await navigator.share({
        title: "Join my PeerLink room",
        text: "Open this private room. I will share the secret separately.",
        url: inviteUrl,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
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

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSecretError(null);
    const submittedSecret = secret;
    setSecret("");
    const result = await state.startAuthentication(submittedSecret);
    if (!result.ok) setSecretError(result.error);
  }

  function offerSelectedFile(file: File | undefined, category: "image" | "file") {
    if (!file) return;
    setPendingFile({ file, category });
    setCompressedFile(null);
    setCompressionProgress(null);
    setTransferError(null);
  }

  function offerSelectedFiles(files: File[]) {
    if (files.length === 0) return;
    if (files.length === 1) {
      offerSelectedFile(files[0], "file");
      return;
    }
    setPendingBatch(files);
    setPendingFile(null);
    setTransferError(null);
  }

  function sendPendingBatch() {
    if (!pendingBatch) return;
    const failures: string[] = [];
    for (const file of pendingBatch) {
      const result = state.offerFile(file, "file");
      if (!result.ok) failures.push(`${file.name}: ${result.error}`);
    }
    setTransferError(failures.length > 0 ? failures.join(" ") : null);
    if (failures.length === 0) setPendingBatch(null);
  }

  function sendPendingFile(file: File) {
    if (!pendingFile) return;
    const result = state.offerFile(file, pendingFile.category);
    setTransferError(result.ok ? null : result.error);
    if (result.ok) closeCompressionDialog();
  }

  function closeCompressionDialog() {
    compressionWorkerRef.current?.terminate();
    compressionWorkerRef.current = null;
    setPendingFile(null);
    setCompressedFile(null);
    setCompressionProgress(null);
  }

  function compressPendingFile() {
    if (!pendingFile || compressionWorkerRef.current) return;
    const worker = new Worker(new URL("./workers/compression.worker.ts", import.meta.url), {
      type: "module",
    });
    compressionWorkerRef.current = worker;
    setCompressionProgress(0);
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!isCompressionWorkerMessage(event.data)) return;
      if (event.data.type === "progress") {
        setCompressionProgress(event.data.progress);
        return;
      }
      compressionWorkerRef.current?.terminate();
      compressionWorkerRef.current = null;
      if (event.data.type === "error") {
        setTransferError(event.data.message);
        setCompressionProgress(null);
        return;
      }
      setCompressedFile(
        new File([event.data.bytes], event.data.name, {
          type: "application/zip",
          lastModified: event.data.lastModified,
        }),
      );
      setCompressionProgress(100);
    });
    worker.postMessage({ file: pendingFile.file });
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
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="min-h-11 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-300/15"
                    onClick={() => void copyInvite()}
                    type="button"
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <button
                    className="min-h-11 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300"
                    onClick={() => void toggleQrCode()}
                    type="button"
                  >
                    {qrCodeUrl ? "Hide QR" : "Show QR"}
                  </button>
                  {canShare ? (
                    <button
                      className="min-h-11 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300"
                      onClick={() => void shareInvite()}
                      type="button"
                    >
                      Share
                    </button>
                  ) : null}
                </div>
                {qrCodeUrl ? (
                  <div className="mt-4 max-w-xs rounded-2xl bg-white p-3">
                    <img
                      alt="QR code containing only the PeerLink room URL"
                      className="aspect-square w-full"
                      src={qrCodeUrl}
                    />
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-slate-500">
                  The QR and share action contain only this room URL—never the shared secret.
                </p>
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
                  label="Connection path"
                  connected={state.connectionPath !== "unknown"}
                  value={connectionPathLabel(state.connectionPath)}
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
                <ConnectionRow
                  label="Authentication"
                  connected={state.authentication === "verified"}
                  value={authenticationLabel(state.authentication, state.authError)}
                />
                <ConnectionRow
                  label="Application encryption"
                  connected={state.authentication === "verified"}
                  value={state.authentication === "verified" ? "AES-256-GCM active" : "Locked"}
                />
                <ConnectionRow label="STUN" connected value="Cloudflare" />
                <ConnectionRow
                  label="TURN fallback"
                  connected={state.turnAvailability === "available"}
                  value={turnAvailabilityLabel(state.turnAvailability)}
                />
                <ConnectionRow label="Server content storage" connected value="None" />
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

          <section className="glass-card rounded-3xl p-6 sm:p-8" aria-label="Peer authentication">
            <div className="grid items-end gap-6 md:grid-cols-[1fr_1.1fr]">
              <div>
                <p className="text-sm font-medium text-cyan-300">Peer authentication</p>
                <h2 className="mt-2 text-2xl font-semibold">
                  {authenticationHeading(state.authentication, state.authError)}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  Both people enter the same secret. A PAKE verifies the match without sending the
                  secret through signaling or across the direct channel.
                </p>
              </div>

              {state.authentication === "required" ? (
                <form onSubmit={(event) => void authenticate(event)}>
                  <label className="text-sm font-medium text-slate-300" htmlFor="shared-secret">
                    Shared secret
                  </label>
                  <div className="mt-2 flex gap-3">
                    <input
                      autoComplete="new-password"
                      className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/50"
                      id="shared-secret"
                      maxLength={SHARED_SECRET_MAX_LENGTH}
                      minLength={SHARED_SECRET_MIN_LENGTH}
                      onChange={(event) => {
                        setSecret(event.target.value);
                        setSecretError(null);
                      }}
                      placeholder="Enter the secret you agreed on"
                      required
                      type="password"
                      value={secret}
                    />
                    <button
                      className="rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={secret.trim().length < SHARED_SECRET_MIN_LENGTH}
                      type="submit"
                    >
                      Verify
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  className={`rounded-2xl border p-4 text-sm ${
                    state.authentication === "verified"
                      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                      : state.authentication === "failed"
                        ? "border-rose-400/25 bg-rose-400/10 text-rose-200"
                        : "border-cyan-300/20 bg-cyan-300/8 text-cyan-100"
                  }`}
                  role="status"
                >
                  {authenticationDescription(state.authentication)}
                </div>
              )}
            </div>
            {secretError || state.authError ? (
              <p className="mt-4 text-sm text-rose-300" role="alert">
                {secretError ?? state.authError}
              </p>
            ) : null}
          </section>

          <section className="glass-card overflow-hidden rounded-3xl" aria-label="File transfers">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-8">
              <div>
                <p className="text-sm font-medium text-slate-400">Encrypted transfers</p>
                <h2 className="mt-1 text-xl font-semibold">Images and files stay peer-to-peer</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <input
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  id="image-picker"
                  onChange={(event) => {
                    offerSelectedFile(event.target.files?.[0], "image");
                    event.target.value = "";
                  }}
                  ref={imagePickerRef}
                  type="file"
                />
                <button
                  className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={state.authentication !== "verified"}
                  onClick={() => imagePickerRef.current?.click()}
                  type="button"
                >
                  Send image
                </button>
                <input
                  className="sr-only"
                  id="file-picker"
                  onChange={(event) => {
                    offerSelectedFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                  multiple
                  ref={filePickerRef}
                  type="file"
                />
                <button
                  className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={state.authentication !== "verified"}
                  onClick={() => filePickerRef.current?.click()}
                  type="button"
                >
                  Send files
                </button>
                <input
                  className="sr-only"
                  id="folder-picker"
                  multiple
                  onChange={(event) => {
                    offerSelectedFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                  ref={(input) => {
                    folderPickerRef.current = input;
                    input?.setAttribute("webkitdirectory", "");
                  }}
                  type="file"
                />
                <button
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={state.authentication !== "verified"}
                  onClick={() => folderPickerRef.current?.click()}
                  type="button"
                >
                  Send folder
                </button>
              </div>
            </div>

            {activeTransfers ? (
              <p
                className="mx-6 mt-6 rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-100 sm:mx-8"
                role="status"
              >
                Keep PeerLink open until the transfer finishes. Mobile browsers may pause work when
                this page is in the background.
              </p>
            ) : null}

            {pendingBatch ? (
              <div className="mx-6 mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/6 p-5 sm:mx-8">
                <p className="font-medium">Send {pendingBatch.length} files</p>
                <p className="mt-1 text-sm text-slate-400">
                  {formatBytes(pendingBatch.reduce((total, file) => total + file.size, 0))} total.
                  Each file remains individually encrypted and verified.
                </p>
                <div className="mt-5 flex gap-3">
                  <button
                    className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950"
                    onClick={sendPendingBatch}
                    type="button"
                  >
                    Send batch
                  </button>
                  <button
                    className="text-sm text-slate-400 underline underline-offset-4"
                    onClick={() => setPendingBatch(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {pendingFile ? (
              <div className="mx-6 mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/6 p-5 sm:mx-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">Send {pendingFile.file.name}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Original: {formatBytes(pendingFile.file.size)}
                    </p>
                  </div>
                  <button
                    className="text-sm text-slate-400"
                    onClick={closeCompressionDialog}
                    type="button"
                  >
                    Close
                  </button>
                </div>
                {isProbablyCompressed(pendingFile.file.name) ? (
                  <p className="mt-4 text-sm text-amber-200">
                    This format is usually already compressed. Sending the original is recommended.
                  </p>
                ) : null}
                {compressionProgress !== null && !compressedFile ? (
                  <div className="mt-4">
                    <p className="text-sm text-slate-300">
                      Compressing locally… {compressionProgress}%
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full bg-cyan-300"
                        style={{ width: `${compressionProgress}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                {compressedFile ? (
                  <p
                    className={`mt-4 text-sm ${compressedFile.size < pendingFile.file.size ? "text-emerald-200" : "text-amber-200"}`}
                  >
                    ZIP: {formatBytes(compressedFile.size)}.{" "}
                    {compressedFile.size < pendingFile.file.size
                      ? `${(((pendingFile.file.size - compressedFile.size) / Math.max(1, pendingFile.file.size)) * 100).toFixed(1)}% saved.`
                      : "Compression did not reduce this file; send the original."}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                    disabled={compressionWorkerRef.current !== null}
                    onClick={() => sendPendingFile(pendingFile.file)}
                    type="button"
                  >
                    Send original
                  </button>
                  {compressedFile ? (
                    <button
                      className="rounded-xl border border-cyan-300/25 px-4 py-2 text-sm font-medium text-cyan-200"
                      onClick={() => sendPendingFile(compressedFile)}
                      type="button"
                    >
                      Send compressed ZIP
                    </button>
                  ) : (
                    <button
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
                      disabled={compressionWorkerRef.current !== null}
                      onClick={compressPendingFile}
                      type="button"
                    >
                      Compress first
                    </button>
                  )}
                  {compressionWorkerRef.current ? (
                    <button
                      className="text-sm text-rose-300 underline underline-offset-4"
                      onClick={closeCompressionDialog}
                      type="button"
                    >
                      Cancel compression
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
              {state.transfers.length > 1 ? (
                <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-4 sm:col-span-2">
                  <div className="flex justify-between gap-4 text-sm">
                    <span>Aggregate progress · {state.transfers.length} files</span>
                    <span>
                      {formatBytes(transferredTotalBytes)} / {formatBytes(transferTotalBytes)}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full bg-cyan-300"
                      style={{
                        width: `${transferTotalBytes === 0 ? 100 : (transferredTotalBytes / transferTotalBytes) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {state.transfers.length === 0 ? (
                <p className="text-sm text-slate-400 sm:col-span-2">
                  Choose an image or file after authentication. The receiver must accept before any
                  file bytes are sent.
                </p>
              ) : (
                state.transfers.map((transfer) => (
                  <TransferCard
                    key={transfer.id}
                    onAccept={() => {
                      const result = state.acceptTransfer(transfer.id);
                      if (!result.ok) setTransferError(result.error);
                    }}
                    onCancel={() => {
                      const result = state.cancelTransfer(transfer.id);
                      if (!result.ok) setTransferError(result.error);
                    }}
                    onPause={() => {
                      const result = state.pauseTransfer(transfer.id);
                      if (!result.ok) setTransferError(result.error);
                    }}
                    onResume={() => {
                      const result = state.resumeTransfer(transfer.id);
                      if (!result.ok) setTransferError(result.error);
                    }}
                    onDecline={() => {
                      const result = state.declineTransfer(transfer.id);
                      if (!result.ok) setTransferError(result.error);
                    }}
                    transfer={transfer}
                  />
                ))
              )}
            </div>
            {transferError ? (
              <p className="px-6 pb-6 text-sm text-rose-300" role="alert">
                {transferError}
              </p>
            ) : null}
          </section>

          <section className="glass-card overflow-hidden rounded-3xl" aria-label="Direct chat">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-8">
              <div>
                <p className="text-sm font-medium text-slate-400">Direct chat</p>
                <h2 className="mt-1 text-xl font-semibold">
                  Messages are encrypted before WebRTC sends them
                </h2>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                  <input
                    checked={historyEnabled}
                    className="size-4 accent-cyan-300"
                    onChange={(event) => void toggleLocalHistory(event.target.checked)}
                    type="checkbox"
                  />
                  Save chats locally
                </label>
                <button
                  className="text-slate-400 underline underline-offset-4 disabled:opacity-40"
                  onClick={() => void clearSavedHistory()}
                  type="button"
                >
                  Clear local history
                </button>
              </div>
            </div>

            <ol
              aria-label="Messages"
              aria-live="polite"
              className="flex min-h-64 max-h-[28rem] flex-col gap-4 overflow-y-auto px-6 py-6 sm:px-8"
            >
              {visibleMessages.length === 0 ? (
                <li className="m-auto max-w-md text-center text-sm leading-6 text-slate-400">
                  {state.authentication === "verified"
                    ? "You are verified. Send the first message."
                    : "Chat unlocks when the control DataChannel opens."}
                </li>
              ) : (
                visibleMessages.map((message) => <ChatBubble key={message.id} message={message} />)
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
                  disabled={state.authentication !== "verified"}
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
                  disabled={state.authentication !== "verified" || draft.trim().length === 0}
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

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
          <div className="flex items-center gap-3">
            {installPrompt ? (
              <button
                className="min-h-10 rounded-xl border border-cyan-300/25 px-3 text-xs font-medium text-cyan-200"
                onClick={() => void installApp()}
                type="button"
              >
                Install app
              </button>
            ) : null}
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
              Phase 16
            </span>
          </div>
        </header>
        {children}
        <footer className="text-sm text-slate-500">
          The link finds the room. WebRTC carries the data.
        </footer>
      </section>
    </main>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

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

function TransferCard({
  transfer,
  onAccept,
  onDecline,
  onCancel,
  onPause,
  onResume,
}: {
  transfer: TransferEntry;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const progress = transfer.size === 0 ? 100 : (transfer.bytesTransferred / transfer.size) * 100;
  const active = transfer.status === "waiting" || transfer.status === "transferring";

  return (
    <article
      className="rounded-2xl border border-white/10 bg-slate-950/45 p-4"
      data-transfer-id={transfer.id}
    >
      {transfer.category === "image" && transfer.objectUrl ? (
        <img
          alt={transfer.name}
          className="mb-4 max-h-64 w-full rounded-xl bg-slate-900 object-contain"
          src={transfer.objectUrl}
        />
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium" title={transfer.relativePath ?? transfer.name}>
            {transfer.relativePath ?? transfer.name}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {formatBytes(transfer.size)} ·{" "}
            {transfer.direction === "incoming" ? "From peer" : "To peer"}
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
          {formatTransferStatus(transfer)}
        </span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="h-full bg-cyan-300 transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {formatBytes(transfer.bytesTransferred)} / {formatBytes(transfer.size)}
      </p>

      {transfer.status === "offered" ? (
        <div className="mt-4 flex gap-2">
          <button
            className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950"
            onClick={onAccept}
            type="button"
          >
            Accept
          </button>
          <button
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"
            onClick={onDecline}
            type="button"
          >
            Decline
          </button>
        </div>
      ) : null}
      {active ? (
        <div className="mt-4 flex gap-4">
          {transfer.status === "transferring" ? (
            <button
              className="text-sm text-cyan-200 underline underline-offset-4"
              onClick={onPause}
              type="button"
            >
              Pause
            </button>
          ) : null}
          <button
            className="text-sm text-rose-300 underline underline-offset-4"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {transfer.status === "paused" ? (
        <div className="mt-4 flex gap-4">
          <button
            className="text-sm font-medium text-cyan-200 underline underline-offset-4"
            onClick={onResume}
            type="button"
          >
            Resume
          </button>
          <button
            className="text-sm text-rose-300 underline underline-offset-4"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {transfer.status === "completed" && transfer.objectUrl ? (
        <a
          className="mt-4 inline-block text-sm font-medium text-cyan-200 underline underline-offset-4"
          download={transfer.name}
          href={transfer.objectUrl}
        >
          Download {transfer.name}
        </a>
      ) : null}
      {transfer.error ? <p className="mt-3 text-xs text-rose-300">{transfer.error}</p> : null}
    </article>
  );
}

function formatTransferStatus(transfer: TransferEntry): string {
  if (transfer.status === "completed")
    return transfer.integrity === "verified" ? "Verified" : "Completed";
  return transfer.status.charAt(0).toUpperCase() + transfer.status.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0] ?? "KB";
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index] ?? unit;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

type CompressionWorkerMessage =
  | { type: "progress"; progress: number }
  | { type: "error"; message: string }
  | {
      type: "complete";
      name: string;
      lastModified: number;
      originalSize: number;
      bytes: ArrayBuffer;
    };

function isCompressionWorkerMessage(value: unknown): value is CompressionWorkerMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "progress") return "progress" in value && typeof value.progress === "number";
  if (value.type === "error") return "message" in value && typeof value.message === "string";
  return (
    value.type === "complete" &&
    "name" in value &&
    typeof value.name === "string" &&
    "lastModified" in value &&
    typeof value.lastModified === "number" &&
    "originalSize" in value &&
    typeof value.originalSize === "number" &&
    "bytes" in value &&
    value.bytes instanceof ArrayBuffer
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
  if (phase === "reconnecting") return "Reconnecting…";
  if (phase === "waiting") return "Waiting for your peer";
  if (phase === "negotiating") return "Connecting peer…";
  if (phase === "error") return "Connection failed";
  if (phase === "disconnected") return "Peer disconnected";
  return "Opening room…";
}

function roomStatusDescription(phase: string): string {
  if (phase === "connected") return "Peer connected and the control DataChannel is open.";
  if (phase === "reconnecting")
    return "The network changed. PeerLink is rebuilding signaling and will require verification again.";
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

function connectionPathLabel(path: string): string {
  if (path === "relay") return "TURN relay";
  if (path === "direct") return "Direct peer-to-peer";
  return "Detecting";
}

function turnAvailabilityLabel(availability: string): string {
  if (availability === "available") return "Ready";
  if (availability === "unavailable") return "Not configured";
  return "Checking";
}

function authenticationLabel(authentication: string, authError: string | null): string {
  if (authentication === "verified") return "Secret verified";
  if (authentication === "authenticating") return "Authenticating";
  if (authentication === "failed")
    return isSecretMismatch(authError) ? "Secret mismatch" : "Failed";
  if (authentication === "required") return "Secret required";
  return "Waiting for peer";
}

function authenticationHeading(authentication: string, authError: string | null): string {
  if (authentication === "verified") return "Shared secret verified";
  if (authentication === "authenticating") return "Authenticating…";
  if (authentication === "failed")
    return isSecretMismatch(authError) ? "Secret mismatch" : "Authentication failed";
  if (authentication === "required") return "Enter shared secret";
  return "Waiting for peer";
}

function isSecretMismatch(authError: string | null): boolean {
  return authError?.startsWith("Shared secrets do not match") ?? false;
}

function authenticationDescription(authentication: string): string {
  if (authentication === "verified") return "This peer proved they entered the same secret.";
  if (authentication === "authenticating")
    return "Waiting for both peers to complete verification.";
  if (authentication === "failed") return "The secrets did not match. Start a new room to retry.";
  return "Authentication becomes available after the direct connection opens.";
}
