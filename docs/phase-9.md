# Phase 9 - Privacy and connection status

The room UI now reports signaling, peer connection, authenticated application encryption, selected
ICE path, STUN, TURN availability, and server content storage. The path is derived from the selected
WebRTC candidate pair: a relay candidate displays `TURN relay`; other selected candidates display
`Direct peer-to-peer`.

This is status reporting, not a claim that WebRTC metadata is anonymous. The signaling service and
TURN relay necessarily handle connection metadata, while application payloads remain encrypted and
are not stored by PeerLink servers.
