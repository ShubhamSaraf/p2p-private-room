# Phase 5 — Image sharing

PeerLink supports JPEG, PNG, WebP, and GIF offers. The receiver must accept before encrypted binary chunks are sent. Received images are reconstructed as local object URLs, rendered as previews, and revoked when the session ends.

The browser acceptance test sends a PNG from one peer to the other and confirms the receiver verifies and renders it. No image bytes pass through Cloudflare or require server storage.

Run `npm run check:phase5`.
