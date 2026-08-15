# Phase 3 — Shared-secret authentication

## Implemented

- a new browser-only `@peerlink/crypto` workspace
- balanced CPace over Ristretto255/SHA-512 using `@cipherman/pake-js@0.1.1`
- a fresh 32-byte session ID and room-specific channel binding for every attempt
- explicit mutual HMAC-SHA-512 key confirmation following the CPace draft construction
- strict runtime validation of PAKE shares and confirmation frames
- one authentication attempt per peer connection
- direct chat locked until mutual confirmation succeeds
- clear waiting, secret-required, authenticating, verified, and mismatch UI states
- password input cleared immediately after submission
- confirmation hashing that works on local-network HTTP previews without `crypto.subtle`
- Worker-runtime coverage proving PAKE-shaped frames are rejected as signaling

The shared secret is not added to the URL, logged, persisted, or sent to Cloudflare. Only CPace public shares and confirmation tags cross the direct WebRTC DataChannel. The derived session key remains in browser memory for the lifetime of the peer connection so Phase 4 can use it for application-layer encryption.

## Security status

Phase 3 is a **security beta**, not a production security claim. CPace is a standardized PAKE design, and the selected implementation passes the official draft test vectors, but `@cipherman/pake-js` is pre-1.0 and its project states that it has not been independently audited. Replace or independently audit this dependency before presenting PeerLink as production-secure.

WebRTC already protects transport with DTLS. Phase 4 application-layer message encryption is still pending, so Phase 3 authenticates the peer but does not yet encrypt chat with the CPace-derived key.

Use a secret that is hard to guess and share it over a separate trusted channel. A mismatch permanently locks that peer connection; create a new room to try again.

## Automated acceptance test

Run the complete Phase 3 gate from the repository root:

```powershell
npm run check:phase3
```

The gate runs formatting, linting, strict TypeScript, crypto/protocol/UI/Worker tests, production builds, and real Chrome tests for both matching and mismatched secrets.

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

1. Create a room and open its invite link in a second page or device.
2. Confirm chat remains disabled after both pages show **DataChannel open**.
3. Enter the same secret on both pages and select **Verify**.
4. Confirm both pages show **Shared secret verified**, then exchange messages.
5. Repeat in a new room with different secrets and confirm both pages show **Secret mismatch** while chat stays disabled.

For a second device on the same Wi-Fi, run both services on `0.0.0.0`, set `VITE_SIGNALING_URL` to the computer's LAN Worker URL, and use the computer's LAN frontend URL. `localhost` always refers to the device currently opening the page.

## Deployment (user action)

Phase 3 needs no database, KV namespace, R2 bucket, secret, or new Cloudflare service. The Worker behavior is unchanged, although redeploying keeps the shared protocol release aligned:

```powershell
npm run deploy --workspace @peerlink/signaling
```

Build and deploy the frontend through the Cloudflare Pages project:

- build command: `npm run build --workspace @peerlink/web`
- output directory: `apps/web/dist`
- environment variable: `VITE_SIGNALING_URL=https://peerlink-signaling.shubhamsaraf.workers.dev`

After deployment, point `peerlink.shubhamsaraf.dev` at that Pages project in **Workers & Pages → your project → Custom domains**. Cloudflare will create or validate the DNS record. No passkey or cryptographic secret belongs in Cloudflare environment variables.
