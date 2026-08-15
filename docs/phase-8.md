# Phase 8 - TURN fallback

Phase 8 adds expiring coturn REST credentials served by the signaling Worker. The browser requests
credentials before opening signaling and uses Cloudflare STUN plus the configured TURN UDP, TCP,
and TLS URLs. Missing or unreachable TURN configuration falls back safely to STUN-only operation.

The Worker endpoint is origin-restricted, returns `Cache-Control: no-store`, and reads the permanent
shared secret only from the `TURN_SHARED_SECRET` Worker secret binding. HMAC-SHA-1 is used solely
because coturn's REST authentication protocol specifies it; file integrity remains SHA-256.

Automated tests cover credential shape, expiry, secret absence, origin checks, and normal direct
browser operation. A real relay acceptance test requires the VPS setup in
`infrastructure/coturn/README.md`.
