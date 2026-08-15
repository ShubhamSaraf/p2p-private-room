# Phase 6 — Arbitrary file transfer

Implemented:

- explicit offer, accept, decline, cancel, and completion states
- compact encrypted binary frames with UUID transfer IDs and chunk indexes
- 64 KiB file reads instead of whole-file reads on the sender
- `RTCDataChannel.bufferedAmount` high/low-water backpressure
- progress updates batched to at most ten per second
- local download object URLs and untrusted filename rendering as React text
- multiple concurrent transfer IDs supported by the protocol

The browser gate transfers a multi-chunk text file and compares the reconstructed bytes. Current cross-browser receiving uses Blob-backed in-memory chunks; very large-file disk streaming and multi-gigabyte device testing remain performance acceptance work for Phase 17.

Run `npm run check:phase6`.
