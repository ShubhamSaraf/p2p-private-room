# Phase 7 — File integrity verification

Sender and receiver incrementally hash transfer chunks with SHA-256. The receiver checks offered size, exact chunk count, ordering, and digest before exposing the object URL, then returns an encrypted verification acknowledgement. Corrupt, missing, extra, or reordered chunks fail the transfer.

Run `npm run check:phase7`.

Phases 5–7 require only a frontend deployment. No Cloudflare storage, database, secret, or Worker route is added.
