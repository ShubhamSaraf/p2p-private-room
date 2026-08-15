# Phase 1 — WebRTC connection

## Implemented

- cryptographically random 192-bit room IDs encoded as 32 URL-safe characters
- `POST /api/rooms` room creation endpoint
- invite routes at `/r/:roomId` with a copy-link control
- one SQLite-backed Durable Object instance per room
- maximum of two active WebSocket peers per room
- hibernatable Durable Object WebSockets with serialized peer-role attachments
- runtime-validated SDP offer, SDP answer, and ICE candidate forwarding
- deterministic initiator/responder negotiation with replacement-peer support
- a browser `RTCPeerConnection` using Cloudflare's public STUN endpoint
- an ordered `control` DataChannel
- visible signaling, peer-connection, DataChannel, and error states
- Cloudflare Pages SPA fallback for invite links
- generated Worker runtime/binding types and Workers observability configuration

The Worker does not receive chat messages, files, passkeys, or cryptographic session keys.

## Automated acceptance test

Run the complete Phase 1 gate from the repository root:

```powershell
npm run check:phase1
```

This runs formatting, type-aware linting (including floating-Promise checks), strict TypeScript, 11 unit/Worker-runtime tests, both production bundles, and a real headless-Chrome two-page WebRTC test.

The browser test starts its own local Vite and Wrangler processes. It requires Google Chrome to be installed at its normal system location.

## Manual local test

Terminal 1:

```powershell
npm run dev:signaling
```

Terminal 2:

```powershell
npm run dev:web
```

Then:

1. Open `http://localhost:5173` in Chrome.
2. Select **Create private room**.
3. Copy the displayed invite link.
4. Open the link in a second tab or another browser.
5. Confirm both pages show **Peer connected** and **DataChannel open**.
6. Open the link in a third browser context and confirm it cannot join.
7. Close one peer and confirm the remaining page returns to a waiting state.

## Deployment (user action)

Redeploy the updated signaling Worker:

```powershell
npm run deploy --workspace @peerlink/signaling
```

Configure the Cloudflare Pages project with:

- production branch: `main`
- build command: `npm run build --workspace @peerlink/web`
- build output directory: `apps/web/dist`
- environment variable: `VITE_SIGNALING_URL=https://peerlink-signaling.shubhamsaraf.workers.dev`
- custom domain: `peerlink.shubhamsaraf.dev`

The Worker currently permits the production frontend origin `https://peerlink.shubhamsaraf.dev` and local frontends only when the Worker itself is local.

## Manual compatibility matrix (user action)

The automated test proves Chrome-to-Chrome on one machine. Before Phase 1 is declared network-complete, manually verify:

- Chrome to Firefox
- two computers on the same Wi-Fi
- computer to phone
- two devices on different Internet connections

Direct connections can still fail on restrictive networks until TURN fallback is added in Phase 8.
