# Phase 6.5 — Optional compression

A pre-send decision lets the sender choose the original file or a ZIP created locally by a dedicated Web Worker using `fflate@0.8.3`. The UI reports progress and size savings, allows cancellation, and recommends the original for already-compressed formats or when ZIP increases the size.

Compression never uploads the source file. The gate verifies ZIP interoperability and sends a generated ZIP through the encrypted transfer path.

Run `npm run check:phase6.5`.
