# Phase 18 - Security hardening and threat model

## Trust boundaries and protected assets

- The room URL is an unguessable rendezvous identifier, not an authentication secret.
- The shared secret is entered on each peer and is never sent to signaling, TURN, logs, URLs, or
  local history.
- CPace authenticates peers; directional HKDF-derived AES-256-GCM keys encrypt application frames.
- WebRTC and TURN handle connection metadata. TURN relays ciphertext and necessarily learns peer IPs,
  timing, and byte counts.
- The peer learns the other peer's network address when WebRTC selects a direct candidate.
- Opt-in IndexedDB history is trusted only as local display data and is runtime-validated on load.

## Attacks addressed

- Room capacity, origin checks, request rate limiting, frame-size bounds, role enforcement, and runtime
  protocol validation constrain signaling abuse.
- PAKE confirmation prevents a peer with a different secret from unlocking application encryption.
- Strict counters prevent AES-GCM nonce reuse and reject missing, repeated, or reordered frames.
- File paths reject traversal/control characters; image previews accept only JPEG, PNG, WebP, or GIF
  MIME declarations; React escapes displayed names and messages.
- Cloudflare Pages headers enforce CSP, HTTPS upgrade/HSTS, frame denial, MIME sniffing denial,
  referrer suppression, and restrictive browser permissions.
- TURN credentials are short-lived, rate-limited, origin-restricted, not cacheable, and signed from a
  Worker secret. The permanent coturn secret is not committed or returned.

## Explicit limitations

- A compromised frontend deployment can replace JavaScript and capture secrets or plaintext before
  encryption. Application encryption cannot defend against a malicious endpoint or supply chain.
- A compromised signaling service can deny rooms or manipulate negotiation. PAKE prevents it from
  silently authenticating without the secret, but availability is not protected.
- A malicious authenticated peer can save, screenshot, or redistribute received content.
- Browser/OS compromise, extensions, local malware, traffic analysis, and denial of service are out
  of scope.
- `@cipherman/pake-js` remains version 0.1.1 and has no claimed independent audit. PeerLink must remain
  labeled a security beta until that implementation is independently reviewed or replaced.

## Verification

`npm run check:phase18` runs formatting, linting, strict types, protocol/crypto/Worker/browser tests,
production builds, bundle budgets, and `npm audit`. This review is separate from functional transfer
acceptance, but it is not a substitute for an independent cryptographic or penetration-test review.
