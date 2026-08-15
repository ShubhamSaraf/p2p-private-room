# PeerLink

PeerLink is an accountless, temporary private room for exactly two people. Messages and files travel
between browsers; Cloudflare is used only for room coordination and optional TURN relay metadata.

The implementation has reached Phase 20 beta readiness: authenticated application encryption,
verified/resumable file batches, TURN fallback, optional local-only history, PWA/mobile UX, measured
performance budgets, security headers, production automation, and content-free beta diagnostics.

PeerLink remains a **security beta** because the CPace implementation is pre-1.0 and has not claimed
an independent audit. Read `docs/phase-18.md` before treating it as production-secure.

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer
- A Cloudflare account for deployment
- A coturn VPS for restrictive-network fallback

## Local development

```bash
npm install
npm run dev:signaling
```

In a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The page calls the local Worker at `http://localhost:8787` by default.

## Useful commands

```bash
npm run check
npm run check:phase18
npm run check:phase20
npm run benchmark:transfer
npm run build
npm run test
npm run lint
npm run format
```

## Repository map

- `apps/web` — React, TypeScript, Vite, Tailwind, and PWA frontend for Cloudflare Pages.
- `apps/signaling` — Cloudflare Worker and per-room Durable Object.
- `packages/protocol` — runtime-validated shared protocol.
- `packages/crypto` — browser-side CPace authentication and application encryption.
- `packages/transfer` — chunking, backpressure, ZIP, integrity, and resume helpers.
- `infrastructure/coturn` — TURN deployment configuration and operator instructions.
- `docs` — phase records, threat model, deployment, and beta instructions.

The signaling service forwards only SDP and ICE negotiation messages. Chat, PAKE, and transfer frames
travel over WebRTC and are never stored by the Worker. Optional chat history stays in the user's
IndexedDB and is off by default.
