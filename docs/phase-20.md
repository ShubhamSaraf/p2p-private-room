# Phase 20 - Public beta readiness

PeerLink now exposes a user-initiated `Copy beta diagnostics` report containing only connection state,
direct/relay path, TURN availability, authentication state, aggregate transfer counts/bytes, and broad
platform capabilities. It excludes room IDs/URLs, IP addresses, secrets, message text, file names,
MIME types, hashes, and content. Nothing is automatically uploaded.

The GitHub beta issue template repeats those privacy rules. Operators can combine consented reports
with aggregate Cloudflare request counts and coturn bandwidth logs to evaluate connection success,
direct-versus-relay usage, transfer failures, and mobile/browser patterns without content analytics.

## Real-user acceptance matrix

Test at minimum:

- Current Chrome, Firefox, Safari, and Edge
- Windows, macOS, Linux, Android, iPhone, and iPad
- Same Wi-Fi, unrelated home networks, Wi-Fi/cellular, cellular/cellular, and restrictive networks
- Direct and forced TURN paths
- Matching and mismatched secrets
- Text, image, 1 KiB, 1 MiB, 100 MiB, 500 MiB, and device-appropriate 1 GiB+ files
- Multiple files, a folder, compression, pause/resume, a brief network switch, PWA installation, and
  local-history clear behavior

Phase 20 is **beta-ready**, not accepted by code alone. Public-beta acceptance requires actual users
to complete this matrix, the custom domain to be live, coturn to pass a forced-relay test, and the
unaudited PAKE limitation in Phase 18 to remain prominently disclosed.
