import { PRODUCT_NAME, type ServiceHealth } from "@peerlink/protocol";
import { useEffect, useState } from "react";

import { SIGNALING_URL } from "./config";

type HealthState = "checking" | "connected" | "unavailable";

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch(`${SIGNALING_URL}/health`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Health request failed: ${response.status}`);

        const result = (await response.json()) as ServiceHealth;
        setHealth(
          result.status === "ok" && result.product === PRODUCT_NAME ? "connected" : "unavailable",
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setHealth("unavailable");
        }
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, []);

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
            Phase 0
          </span>
        </header>

        <div className="grid flex-1 items-center gap-14 py-20 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="mb-5 text-sm font-medium uppercase tracking-[0.28em] text-cyan-300">
              Private by architecture
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-balance sm:text-7xl">
              A room for two. Nothing left behind.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              Temporary browser-to-browser rooms for messages and files. Cloudflare introduces the
              peers; WebRTC carries their data.
            </p>
            <button
              className="mt-10 cursor-not-allowed rounded-2xl bg-cyan-300 px-6 py-3.5 font-semibold text-slate-950 opacity-70"
              disabled
              type="button"
            >
              Create private room · Phase 1
            </button>
          </div>

          <aside className="glass-card rounded-3xl p-6 sm:p-8" aria-label="Foundation status">
            <p className="text-sm font-medium text-slate-400">Foundation status</p>
            <h2 className="mt-2 text-2xl font-semibold">Ready for WebRTC</h2>
            <dl className="mt-8 space-y-5 text-sm">
              <StatusRow label="React application" value="Ready" />
              <StatusRow label="Shared protocol" value="Ready" />
              <StatusRow
                label="Signaling service"
                value={
                  health === "checking"
                    ? "Checking…"
                    : health === "connected"
                      ? "Connected"
                      : "Start locally"
                }
                state={health}
              />
              <StatusRow label="Content stored on server" value="None" />
            </dl>
          </aside>
        </div>

        <footer className="text-sm text-slate-500">
          The link finds the room. WebRTC carries the data.
        </footer>
      </section>
    </main>
  );
}

function StatusRow({ label, value, state }: { label: string; value: string; state?: HealthState }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-5 last:border-0 last:pb-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="flex items-center gap-2 font-medium text-slate-100">
        {state ? (
          <span
            className={`size-2 rounded-full ${
              state === "connected"
                ? "bg-emerald-400"
                : state === "unavailable"
                  ? "bg-amber-400"
                  : "animate-pulse bg-cyan-300"
            }`}
            aria-hidden="true"
          />
        ) : null}
        {value}
      </dd>
    </div>
  );
}
