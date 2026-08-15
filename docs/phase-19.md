# Phase 19 - Production deployment

## Automated deployment

CI runs the Phase 18 gate on pushes and pull requests. Production deployment is intentionally a
manual GitHub Actions dispatch so a passing commit is not published accidentally. Add these GitHub
repository environment secrets under the `production` environment:

- `CLOUDFLARE_ACCOUNT_ID` - `7123ba1ff07afcb9512dc6ea9439b8cb`
- `CLOUDFLARE_API_TOKEN` - a scoped token with Workers Scripts, Durable Objects, Pages, and Account
  Settings read permissions; do not use or commit a Global API Key

The workflow deploys the Worker, builds with the production signaling URL, and publishes the Pages
project. The account-assigned fallback hostname is `https://peerlink-387.pages.dev`. Local production
deployment can use the already-authenticated Wrangler session.

## User-side Cloudflare steps

1. In **Workers & Pages > peerlink > Custom domains**, add `peerlink.shubhamsaraf.dev`. Cloudflare
   creates the DNS record and certificate. Keep the Pages custom-domain record proxied.
2. Complete `infrastructure/coturn/README.md`: provision the VPS, create the **DNS-only** `turn`
   record, open the listed ports, install the certificate, and start coturn.
3. Set the coturn shared secret interactively with
   `npm exec wrangler -- secret put TURN_SHARED_SECRET --config apps/signaling/wrangler.jsonc`, then
   redeploy the Worker. Never paste that value into Git, GitHub variables, chat, or command arguments.
4. Verify `https://peerlink.shubhamsaraf.dev`, Worker `/health`, direct Wi-Fi, unrelated networks,
   forced TURN, matching/mismatched secrets, a batch, and a resumed large file.

Cloudflare Pages/Workers provide HTTPS. Pages `_headers` supplies the production CSP and hardening
headers. Application logs contain event/error metadata only, never message, file, or secret content.
