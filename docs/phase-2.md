# Phase 2 — Basic text chat

## Implemented

- direct two-way text chat over the existing ordered `control` RTCDataChannel
- UUID message IDs and sender timestamps
- shared runtime validation for incoming chat messages
- a 2,000-character message limit and bounded in-memory rendering history
- outgoing and incoming message bubbles with local timestamps
- send controls that remain locked until the DataChannel opens
- duplicate message-ID suppression
- chat history cleared when the peer session ends
- explicit Worker-runtime coverage proving chat-shaped signaling frames are rejected

Chat messages exist only in the two browser pages. They are not sent through the signaling WebSocket, stored in the Durable Object, or persisted locally.

## Automated acceptance test

Run the complete Phase 2 gate from the repository root:

```powershell
npm run check:phase2
```

This runs formatting, linting, strict TypeScript, protocol/UI/Worker-runtime tests, production builds, and a real Chrome test that connects two pages and sends messages in both directions.

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

1. Open `http://localhost:5173` and create a private room.
2. Open the invite link in another browser page or device.
3. Wait until both pages show **DataChannel open**.
4. Send a message from each side and confirm both messages appear on both pages.
5. Disconnect one peer and confirm the remaining page returns to the waiting state and clears the session chat.

For another device on the same Wi-Fi, both dev servers must listen on the LAN interface and the frontend must use the PC's LAN signaling URL. Do not share a `localhost` invite URL.

## Deployment (user action)

The signaling API and Durable Object bindings do not change in Phase 2, so a Worker redeploy is not required for chat to work. To keep the deployed monorepo release aligned, you may redeploy it with:

```powershell
npm run deploy --workspace @peerlink/signaling
```

Build and deploy the frontend through the existing Cloudflare Pages project:

- build command: `npm run build --workspace @peerlink/web`
- output directory: `apps/web/dist`
- environment variable: `VITE_SIGNALING_URL=https://peerlink-signaling.shubhamsaraf.workers.dev`

No database, KV namespace, R2 bucket, secret, or additional Cloudflare service is required for Phase 2.
