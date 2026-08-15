# Phase 14 - Progressive Web App

PeerLink now ships a web app manifest, maskable SVG icon, install prompt integration, and a small
same-origin service worker. The worker caches the application shell and subsequently requested
hashed assets, provides a navigation fallback while offline, and never caches signaling or TURN
responses because those are on the separate signaling origin.

The production build copies and validates the manifest/service-worker assets. Install prompts are
browser-controlled and require HTTPS in production. An installed PWA still cannot promise unlimited
background transfer execution on mobile platforms.
