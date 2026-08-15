# Phase 12 - QR code and sharing

The invite panel can copy the room URL, generate a QR code entirely in the browser, or invoke the
Web Share API where supported. Every route contains only the validated room URL. PeerLink explicitly
asks users to communicate the shared secret separately and never encodes it in the QR/share payload.

The browser gate generates the QR and verifies it is a local data image before the second peer joins.
