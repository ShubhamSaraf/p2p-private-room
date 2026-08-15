# Phase 16 - Pause and resume

Encrypted transfer control now includes pause, resume, and resume-offer messages with transfer ID,
next chunk, and byte offset. Either peer can pause an accepted transfer. Resume state must align to
the fixed binary chunk boundary (or exact file end), and inconsistent state is rejected.

During signaling/WebRTC recovery, accepted outgoing `File` handles and incoming verified chunks stay
in that open browser page. After fresh PAKE authentication and fresh application keys, the sender
offers its partial state, the receiver returns the authoritative received offset, the sender rehashes
the retained prefix, and only missing chunks continue. Offers that were never accepted are cancelled.

This does not survive a browser reload or operating-system process eviction: browsers do not provide
a portable persistent `File` handle by default. The transfer primitive tests cover valid and invalid
resume offsets; end-to-end tests continue to compare final bytes and hashes.
