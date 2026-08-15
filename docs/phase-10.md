# Phase 10 - Optional local chat history

Chat persistence remains off by default. A user can opt in from the chat panel; PeerLink then stores
that browser's displayed messages in IndexedDB, partitioned by room ID. The preference and messages
never go to the signaling Worker, and the shared secret is never written to storage.

`Clear local history` deletes every saved chat record on that browser. Disabling persistence stops
loading and saving history but does not silently delete it, so deletion remains an explicit action.

The automated storage tests verify the default, preference, room partitioning, and clearing behavior.
