# PeerLink

PeerLink is an accountless, temporary private room for exactly two people. Cloudflare is used only to create rooms and exchange WebRTC signaling data; messages and files will travel between browsers.

The project is being implemented one tested phase at a time. Phase 4 adds directional AES-256-GCM application encryption after CPace authentication, so chat plaintext is never placed on the DataChannel. Cloudflare still handles only room creation and WebRTC signaling. See [docs/phase-4.md](docs/phase-4.md) for its acceptance checklist and security design.

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer
- A Cloudflare account (only needed for deployment)

## Local development

```bash
npm install
npm run dev:signaling
```

In a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The page calls the Worker health endpoint at `http://localhost:8787` by default.

## Useful commands

```bash
npm run check
npm run check:phase1
npm run check:phase2
npm run check:phase3
npm run check:phase4
npm run build
npm run test
npm run lint
npm run format
```

## Repository map

- `apps/web` — React, TypeScript, Vite, and Tailwind frontend; deployed to Cloudflare Pages.
- `apps/signaling` — Cloudflare Worker and room Durable Object.
- `packages/protocol` — types and constants shared by both applications.
- `packages/crypto` — browser-side CPace authentication and explicit key confirmation.
- `docs` — phase records and operator instructions.

The signaling service forwards only SDP and ICE negotiation messages. Chat and PAKE messages travel directly between browsers and are never sent to or stored by the Worker. Phase 3 is security-beta because its pre-1.0 PAKE dependency has not received an independent audit; see the phase record before treating it as production-secure.
