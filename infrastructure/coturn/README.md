# PeerLink TURN deployment

This is the user-operated Phase 8 component. The application works with direct WebRTC and STUN
without it, but restrictive networks need TURN.

## 1. DNS and firewall

Create a Cloudflare **DNS-only** `A` record named `turn` pointing to the VPS public IPv4 address.
Do not proxy this record: coturn is not HTTP traffic.

Allow these inbound ports in both the VPS provider firewall and the OS firewall:

- UDP and TCP `3478` for TURN
- TCP `5349` for TURN over TLS
- UDP `49160-49200` for relayed media/data

If IPv6 is enabled, add an `AAAA` record and equivalent IPv6 firewall rules.

## 2. TLS and coturn

Install Docker Compose and obtain a certificate for `turn.shubhamsaraf.dev` with Certbot. Port 80
can be opened temporarily for an HTTP-01 certificate, or use a Cloudflare DNS-01 challenge.

Copy `turnserver.conf.example` to the ignored `turnserver.conf`. Replace the public IP and generate
a high-entropy shared secret. Put that same secret in `static-auth-secret` and in the Worker secret
in step 3. Never commit `turnserver.conf`.

Start and inspect coturn:

```sh
docker compose up -d
docker compose logs -f coturn
```

The host network is intentional: TURN opens a relay port range and does not fit a small static
Docker port mapping well.

## 3. Configure the Worker secret

From the repository root, run this interactive command and paste only the shared secret value:

```sh
npm exec wrangler -- secret put TURN_SHARED_SECRET --config apps/signaling/wrangler.jsonc
npm run deploy --workspace @peerlink/signaling
```

The Worker uses the secret to mint one-hour coturn REST credentials. The permanent secret is never
sent to a browser. For local testing, create `apps/signaling/.dev.vars` from `.dev.vars.example`.

## 4. Acceptance test

Open a room on two devices. In Chrome DevTools, block direct UDP or test one device through a
restrictive/mobile network. The connection panel must say `TURN relay`, then chat and a file must
still complete. Also test normal Wi-Fi and confirm it says `Direct peer-to-peer`.
