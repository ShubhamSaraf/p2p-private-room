# Phase 4 — Application-level encryption

## Implemented

- HKDF-SHA-256 key separation from the authenticated CPace session key
- independent initiator-to-responder and responder-to-initiator AES-256-GCM keys
- deterministic 96-bit nonces backed by a strictly increasing 64-bit counter per directional key
- protocol version and nonce bound as authenticated additional data
- encrypted control envelopes with strict size and shape validation
- rejection of plaintext chat frames after authentication
- replay, skipped-counter, reordered-frame, and tamper rejection
- PAKE session material destroyed after application keys are derived
- application keys destroyed when the peer session resets
- a browser assertion proving chat text does not appear in sent DataChannel frames

The pure-JavaScript AES-GCM implementation comes from the independently audited `@noble/ciphers` package and keeps LAN HTTP previews functional. Production still requires HTTPS in Phase 18.

## Test

```powershell
npm run check:phase4
```

No new Cloudflare service or environment variable is required. Only the frontend needs deployment for this phase; application ciphertext still travels directly over WebRTC.
