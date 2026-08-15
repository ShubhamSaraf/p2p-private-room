# PeerLink

PeerLink is an accountless, temporary private room for exactly two people. Cloudflare is used only to create rooms and exchange WebRTC signaling data; messages and files will travel between browsers.

The project is being implemented one tested phase at a time. Phase 1 now creates two-person rooms and establishes a WebRTC control DataChannel through hibernatable WebSocket signaling. See [docs/phase-1.md](docs/phase-1.md) for its acceptance checklist and deployment instructions.

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
npm run build
npm run test
npm run lint
npm run format
```

## Repository map

- `apps/web` — React, TypeScript, Vite, and Tailwind frontend; deployed to Cloudflare Pages.
- `apps/signaling` — Cloudflare Worker and room Durable Object.
- `packages/protocol` — types and constants shared by both applications.
- `docs` — phase records and operator instructions.

The signaling service forwards only SDP and ICE negotiation messages. Application messages and files must never be sent to or stored by it.
