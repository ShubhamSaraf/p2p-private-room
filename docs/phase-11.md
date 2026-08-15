# Phase 11 - Room lifecycle and reconnection

Rooms now have a persisted creation timestamp, a 24-hour maximum lifetime, and a five-minute grace
period after the final signaling socket closes. The room Durable Object stores only lifecycle
metadata in SQLite. A Durable Object alarm tombstones an empty or over-age room; an expired room ID
cannot silently become a new room.

After a previously-open signaling connection is interrupted, the browser retries with bounded
exponential backoff for up to five minutes. It recreates the RTCPeerConnection and DataChannel and
requires PAKE authentication again, which also creates fresh application-encryption keys. Initial
join failures such as a full or expired room remain terminal instead of retrying forever.

Worker-runtime tests cover peer replacement during the grace window, lifecycle alarm expiry, and
WebSocket hibernation/eviction. Browser tests continue to cover connection, reauthentication, chat,
and transfer behavior.
