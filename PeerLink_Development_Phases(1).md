# PeerLink — Development Phases

**Project:** `p2p-private-room`  
**Product:** **PeerLink**  
**Planned website:** `peerlink.shubhamsaraf.dev`

This document defines a practical development order for PeerLink so that the project can be built and tested incrementally without trying to solve WebRTC, security, file transfer, compression, TURN, and UI polish all at once.

---

# Phase 0 — Project Setup and Folder Layout

## Goal

Create a clean development environment and repository structure where each deployable part of PeerLink has its own folder.

All source code should live in **one GitHub repository**, but different folders will be deployed to different services.

## Important deployment mapping

```text
p2p-private-room/
│
├── apps/
│   ├── web/              -> Cloudflare Pages
│   └── signaling/        -> Cloudflare Worker + Durable Object
│
├── packages/             -> Shared code used by the apps
│
└── infrastructure/
    └── coturn/           -> TURN server configuration later
```

You do **not** need a separate Durable Objects application folder. The Durable Object code belongs inside the signaling Worker project because it is deployed as part of that Worker.

## Start with this minimal structure

For Phase 0 and Phase 1, do not create every future folder immediately. Start with:

```text
p2p-private-room/
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   │
│   └── signaling/
│       ├── src/
│       │   ├── worker.ts
│       │   └── room.ts
│       ├── wrangler.jsonc
│       └── package.json
│
├── packages/
│   └── protocol/
│       ├── src/
│       └── package.json
│
├── docs/
│
├── package.json
└── README.md
```

## What each folder is for

### `apps/web/`

This is the PeerLink website.

It contains:

- React UI,
- room creation/join screens,
- WebRTC browser logic,
- connection status,
- later chat/image/file UI.

Deployment target:

```text
Cloudflare Pages
```

Planned domain:

```text
peerlink.shubhamsaraf.dev
```

---

### `apps/signaling/`

This is the Cloudflare signaling backend.

It contains:

- Cloudflare Worker entry point,
- WebSocket upgrade handling,
- room creation/join routing,
- SDP offer forwarding,
- SDP answer forwarding,
- ICE candidate forwarding,
- Durable Object room implementation.

Suggested files:

```text
apps/signaling/src/worker.ts
apps/signaling/src/room.ts
```

Deployment target:

```text
Cloudflare Workers
+
Cloudflare Durable Objects
```

The Durable Object is **not** a separate server you manually deploy. It is part of the Worker project.

---

### `packages/protocol/`

This contains message definitions shared by the frontend and signaling code.

Examples:

```text
RoomCreated
PeerJoined
Offer
Answer
IceCandidate
PeerLeft
```

Later it can also define encrypted application/control message envelopes.

This folder is not deployed as its own website or server. It is imported by the other apps.

---

## Add these folders only when their phase begins

Do not create unnecessary empty folders on day one.

### Add during WebRTC code cleanup

```text
packages/webrtc/
```

Purpose:

- `RTCPeerConnection` creation,
- ICE handling,
- DataChannel setup,
- connection state,
- STUN/TURN configuration.

---

### Add during shared-secret/encryption phases

```text
packages/crypto/
```

Purpose:

- PAKE integration,
- session-key handling,
- AES-GCM encryption,
- nonce handling,
- key separation.

---

### Add during file-transfer phases

```text
packages/transfer/
```

Purpose:

- file sender,
- file receiver,
- chunking,
- backpressure,
- progress calculation,
- hashing,
- compression helpers.

---

### Add when TURN is introduced

```text
infrastructure/coturn/
```

Purpose:

- coturn configuration,
- deployment notes,
- TURN/STUN server setup.

Deployment target:

```text
A VPS later
```

Potential hostname:

```text
turn.shubhamsaraf.dev
```

---

## Full target repository structure

As the project grows, the repository can become:

```text
p2p-private-room/
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── pages/
│   │   │   └── workers/
│   │   ├── public/
│   │   └── package.json
│   │
│   └── signaling/
│       ├── src/
│       │   ├── worker.ts
│       │   ├── room.ts
│       │   ├── websocket.ts
│       │   └── protocol.ts
│       ├── wrangler.jsonc
│       └── package.json
│
├── packages/
│   ├── protocol/
│   ├── webrtc/
│   ├── crypto/
│   └── transfer/
│
├── infrastructure/
│   └── coturn/
│
├── docs/
│
├── package.json
├── tsconfig.json
└── README.md
```

## Deployment summary

```text
GitHub repository
p2p-private-room
      │
      ├── apps/web/
      │      ↓
      │   Cloudflare Pages
      │   peerlink.shubhamsaraf.dev
      │
      ├── apps/signaling/
      │      ↓
      │   Cloudflare Worker
      │      +
      │   Durable Objects
      │
      └── infrastructure/coturn/
             ↓
          VPS later
          turn.shubhamsaraf.dev
```

GitHub remains the **single source of truth**. You should not manually maintain different copies of the code on different services.

## Tasks

- Create the project folder:

```text
p2p-private-room/
```

- Initialize Git.
- Create a GitHub repository.
- Set up npm workspaces or another simple monorepo structure.
- Create only:
  - `apps/web/`
  - `apps/signaling/`
  - `packages/protocol/`
  - `docs/`
- Set up React + TypeScript + Vite in `apps/web/`.
- Set up Cloudflare Worker + Durable Object in `apps/signaling/`.
- Add shared TypeScript message types in `packages/protocol/`.
- Add linting and formatting.
- Add basic environment variable handling.
- Add a simple README.
- Confirm local frontend development works.
- Confirm Cloudflare Worker can be deployed to the free tier.

## Done when

- `npm install` works.
- Frontend opens locally from `apps/web/`.
- Worker responds from `apps/signaling/`.
- Durable Object binding is configured.
- Shared protocol package can be imported.
- Git repository is clean and committed.

---

# Phase 1 — Establish a WebRTC Connection

## Main folders used in this phase

```text
apps/web/
apps/signaling/
packages/protocol/
```

Do not create `packages/crypto/`, `packages/transfer/`, or `infrastructure/coturn/` yet unless needed for experimentation.

## Goal

Get two browsers connected through WebRTC.

Do not build chat, encryption, compression, or file transfer yet.

## User flow

```text
User A
  |
Create Room
  |
Receive room link
  |
Share link
  |
User B opens link
  |
Cloudflare signaling
  |
SDP + ICE exchange
  |
RTCDataChannel opens
  |
Both users see:
CONNECTED
```

## Backend work

Implement:

- room ID generation,
- room creation,
- room join,
- one Durable Object per room,
- maximum two peers,
- WebSocket connection to the room,
- SDP offer forwarding,
- SDP answer forwarding,
- ICE candidate forwarding,
- peer disconnect handling.

## Frontend work

Implement:

- landing page,
- `Create Room` button,
- room page,
- copy invite link,
- basic connection status.

## WebRTC work

Use:

- `RTCPeerConnection`
- `RTCDataChannel`
- ICE
- STUN

For this phase, public STUN is enough.

## Testing

Test:

- two browser tabs,
- Chrome to Chrome,
- Chrome to Firefox,
- two computers on the same Wi-Fi,
- computer to phone,
- two different Internet connections.

## Done when

Both devices consistently show:

```text
Peer connected
DataChannel open
```

---

# Phase 2 — Basic Text Chat

## Goal

Send messages directly over the WebRTC DataChannel.

## Tasks

Create a `control` DataChannel.

Implement:

- message input,
- send button,
- outgoing message display,
- incoming message display,
- timestamps,
- basic message IDs.

Example protocol:

```ts
type ChatMessage = {
  type: "chat";
  id: string;
  timestamp: number;
  text: string;
};
```

Add runtime message validation.

Recommended library:

```text
zod
```

## Important rule

Chat messages must travel:

```text
Browser A
   |
WebRTC DataChannel
   |
Browser B
```

They should not go through the Cloudflare Worker.

## Done when

Two users can exchange text messages after connecting.

---

# Phase 3 — Shared Secret / Passkey

## Folder added in this phase

Create:

```text
packages/crypto/
```

Use it for PAKE/session-authentication code shared by the browser-side security layer.

## Goal

Require both peers to enter the same secret before the room becomes usable.

## User flow

```text
Peer connected
     |
Both users enter secret
     |
Authentication begins
     |
Same secret?
   /      \
 Yes      No
  |        |
Unlock   Reject
 room
```

## Tasks

- Add passkey entry screen.
- Do not send the passkey to Cloudflare.
- Do not place the passkey in the room URL.
- Do not log the passkey.
- Keep chat locked until peer authentication succeeds.

## Security approach

Use a proper Password-Authenticated Key Exchange.

Candidate protocol families to evaluate:

- OPAQUE
- SPAKE2
- SPAKE2+
- CPace

Do not design a custom password-authentication protocol.

## UI states

```text
Waiting for peer
Peer connected
Enter shared secret
Authenticating
Secret verified
Secret mismatch
```

## Done when

Two users with the same secret can unlock the room.

Two users with different secrets cannot communicate through the application session.

---

# Phase 4 — Application-Level Encryption

## Goal

Encrypt PeerLink application messages before placing them into WebRTC.

WebRTC is already transport-encrypted, but PeerLink should add its own encrypted application session.

## Tasks

- Derive session key material from the authenticated session.
- Separate cryptographic keys by purpose.
- Use HKDF if appropriate.
- Use AES-256-GCM for authenticated encryption.
- Generate unique nonces.
- Never reuse an AES-GCM nonce with the same key.
- Encrypt all control messages.

Conceptual flow:

```text
Chat message
    |
serialize
    |
encrypt
    |
WebRTC
    |
decrypt
    |
validate
    |
display
```

## Done when

No plaintext application message is placed directly on the DataChannel.

---

# Phase 5 — Image Sharing

## Goal

Allow users to send images directly between browsers.

## Tasks

- Add attachment button.
- Support:
  - JPEG,
  - PNG,
  - WebP,
  - GIF if desired.
- Send image metadata first.
- Require receiver acceptance if desired.
- Transfer image as binary data.
- Reconstruct image in receiver.
- Create local Object URL.
- Display image preview.
- Revoke unused Object URLs.

## Example flow

```text
Choose image
    |
Send metadata
    |
Transfer chunks
    |
Receiver reconstructs
    |
Display preview
```

## Done when

Images can be sent between desktop and mobile browsers without server storage.

---

# Phase 6 — Arbitrary File Transfer

## Folder added in this phase

Create:

```text
packages/transfer/
```

Use it for chunking, sender/receiver logic, backpressure, transfer state, hashing helpers, and later compression support.

## Goal

Support large files without loading the whole file into memory.

## Tasks

Implement:

- file offer,
- accept,
- decline,
- cancel,
- file metadata,
- binary chunking,
- transfer IDs,
- progress tracking,
- backpressure,
- completion event.

Suggested starting chunk size:

```text
64 KiB - 256 KiB
```

Benchmark before choosing a permanent default.

## Backpressure

Use:

```text
RTCDataChannel.bufferedAmount
RTCDataChannel.bufferedAmountLowThreshold
```

Do not continuously queue data if the browser's outgoing buffer is already full.

## UI

Example:

```text
dataset.laz
3.7 GB

██████████████░░░░░░
68%

2.52 GB / 3.70 GB
28.5 MB/s
47 sec remaining

[ Cancel ]
```

## Testing

Test gradually:

```text
1 KB
1 MB
100 MB
500 MB
1 GB+
```

Then test larger datasets.

## Done when

Large files transfer without freezing the UI or exhausting memory.

---

# Phase 6.5 — Optional Compression Before Sending

## Goal

Let the sender choose between the original file and a locally compressed version.

## User flow

```text
Select file
    |
    v

○ Send original

○ Compress first
    |
    v
Local compression
    |
    v
Show result
    |
    v
Send compressed file
```

## Tasks

Add a pre-send dialog:

```text
Send File

data.csv
2.4 GB

○ Send original
  2.4 GB

○ Compress before sending
  Compression runs locally

[ Cancel ] [ Continue ]
```

Run compression inside a Web Worker.

Candidates to evaluate:

```text
fflate
@zip.js/zip.js
```

Initial format:

```text
ZIP
```

Display:

- compression progress,
- original size,
- compressed size,
- percentage saved,
- cancel option.

If compression makes the file larger:

```text
Compression did not reduce this file.

Original: 850 MB
ZIP:      854 MB

Recommended: Send original
```

Warn when the format is already compressed:

```text
.jpg
.png
.mp4
.mp3
.zip
.7z
```

## Done when

Users can choose either:

```text
Original file
```

or:

```text
Compressed ZIP
```

before transfer starts.

---

# Phase 7 — File Integrity Verification

## Goal

Detect corrupted or incomplete transfers.

## Tasks

- Compute SHA-256 for sender file.
- Compute SHA-256 for received file.
- Compare digests.
- Run hashing outside the main UI thread where practical.

Display:

```text
✓ File verified
```

or:

```text
⚠ File integrity verification failed
```

## Done when

Every completed file transfer can be cryptographically verified.

---

# Phase 8 — TURN Fallback

## Folder added in this phase

Create:

```text
infrastructure/coturn/
```

This folder contains coturn configuration and deployment notes. It is later deployed to a VPS and is not part of Cloudflare Pages or the Worker runtime.

## Goal

Make PeerLink work on networks where direct P2P cannot be established.

## Infrastructure

Deploy:

```text
coturn
```

Suggested hostname:

```text
turn.shubhamsaraf.dev
```

## ICE strategy

```text
Try direct host candidate
        |
Try STUN-derived candidate
        |
If necessary
        |
Use TURN relay
```

## UI

Direct:

```text
⚡ Direct P2P
```

TURN:

```text
↪ TURN relay
```

## Testing

Test on:

- home Wi-Fi,
- mobile hotspot,
- cellular data,
- university network,
- corporate/restrictive networks,
- different NAT configurations.

## Done when

Users who cannot establish a direct connection can still connect through TURN.

---

# Phase 9 — Connection and Security Status

## Goal

Make the privacy model transparent.

## Add status panel

Example:

```text
Connection

🔒 Shared secret verified
🔐 Application encryption active
⚡ Direct peer-to-peer
🌐 STUN active
↪ TURN not in use
```

If relayed:

```text
Connection

🔒 Shared secret verified
🔐 Application encryption active
↪ TURN relay active
```

Storage panel:

```text
Server Storage

Messages       None
Images         None
Files          None
Passkey        None
Chat history   None
```

## Done when

Users can clearly understand whether the connection is direct or relayed and what the server stores.

---

# Phase 10 — Local Chat History

## Goal

Allow optional device-local persistence without adding server-side databases.

## Technology

Use:

```text
IndexedDB
```

## Possible local data

- message history,
- recent room metadata,
- UI preferences,
- transfer history.

## Privacy setting

Recommended default:

```text
Save chats locally
[ OFF ]
```

Provide:

```text
Clear local history
```

Never store the room passkey in plaintext.

## Done when

Users can optionally retain their own history locally.

---

# Phase 11 — Room Lifecycle and Reconnection

## Goal

Handle real-world disconnects.

## Room lifecycle

```text
Create room
    |
Peer joins
    |
Connect
    |
Authenticate
    |
Active
    |
Temporary disconnect
    |
Grace period
    |
Reconnect
```

Suggested initial grace period:

```text
5 minutes
```

Possible maximum room lifetime:

```text
24 hours
```

## Tasks

- disconnected-peer indicator,
- reconnect WebSocket,
- ICE restart if needed,
- recreate DataChannel if needed,
- require reauthentication when appropriate,
- destroy inactive room.

## Done when

Brief network changes do not immediately destroy the user experience.

---

# Phase 12 — QR Code and Sharing UX

## Goal

Make phone-to-computer joining easy.

## Tasks

Add:

```text
[ Copy Link ]
[ Show QR ]
[ Share ]
```

QR should contain only:

```text
room URL
```

Never include the shared passkey automatically.

On supported mobile browsers, optionally use the Web Share API.

## Done when

A desktop user can create a room and another person can join instantly by scanning a QR code.

---

# Phase 13 — Mobile and Responsive Optimization

## Goal

Make PeerLink usable on:

- iPhone,
- iPad,
- Android,
- laptop,
- desktop.

## Tasks

- responsive room layout,
- large touch targets,
- mobile file picker,
- mobile image picker,
- transfer warning when page is backgrounded,
- memory-conscious transfer behavior,
- prevent accidental navigation during active transfer where appropriate.

Display:

```text
Keep PeerLink open until the transfer finishes.
```

## Done when

Phone-to-phone and phone-to-desktop usage is comfortable and reliable.

---

# Phase 14 — PWA

## Goal

Allow PeerLink to behave more like an installed app while remaining web-based.

## Tasks

- web app manifest,
- service worker,
- install prompt,
- icons,
- offline application shell,
- home-screen launch.

Important:

A PWA does not guarantee unlimited background transfers on iOS/Android.

## Done when

Users can install PeerLink from their browser to the home screen.

---

# Phase 15 — Multiple File and Folder Transfer

## Goal

Support batches of files.

## Tasks

Allow:

```text
file A
file B
file C
folder
```

Optionally bundle them into:

```text
transfer.zip
```

Display aggregate progress as well as individual file progress.

## Done when

Users can send a set of files in one operation.

---

# Phase 16 — Pause / Resume

## Goal

Support interruption-resistant large transfers.

## Protocol additions

Track:

```text
transfer ID
file ID
chunk index
byte offset
completed ranges
file digest
```

Reconnection flow:

```text
connection lost
      |
reconnect
      |
authenticate
      |
exchange transfer state
      |
send only missing ranges
```

## Done when

A partially transferred large file does not always need to restart from byte zero.

---

# Phase 17 — Performance Optimization

## Goal

Make transfers as fast as practical.

## Benchmark

Measure:

- chunk size,
- DataChannel buffer thresholds,
- direct LAN,
- direct Internet,
- TURN,
- desktop,
- Android,
- iOS,
- compression throughput,
- encryption overhead,
- hashing throughput.

## Rules

Avoid:

```text
Base64
whole-file buffering
React updates for every chunk
unnecessary ArrayBuffer copying
```

Prefer:

```text
binary buffers
streaming
Web Workers
controlled backpressure
batched progress updates
```

## Done when

PeerLink approaches the practical throughput allowed by the network and browser.

---

# Phase 18 — Security Hardening

## Goal

Prepare for a public release.

## Checklist

- Enforce HTTPS.
- Add strong Content Security Policy.
- Review XSS attack surface.
- Sanitize/escape file names.
- Treat MIME types as untrusted.
- Validate every incoming protocol message.
- Review cryptographic implementation.
- Confirm PAKE library maturity.
- Confirm AES-GCM nonce handling.
- Review key lifecycle.
- Prevent secrets from entering logs.
- Disable sensitive analytics.
- Protect Cloudflare credentials.
- Protect TURN credentials.
- Rate-limit room creation if needed.
- Add dependency scanning.
- Lock dependency versions.
- Add automated tests for malformed peer messages.
- Document threat model.
- Document endpoint-compromise limitation.

## Done when

The security architecture has been reviewed separately from functional testing.

---

# Phase 19 — Production Deployment

## Goal

Publish PeerLink on its intended domain.

## Target architecture

```text
peerlink.shubhamsaraf.dev
    |
Cloudflare Pages
    |
React application


Cloudflare Worker
    |
Durable Objects
    |
WebSocket signaling


turn.shubhamsaraf.dev
    |
coturn
```

## Tasks

- connect GitHub repository,
- automated frontend deployment,
- automated Worker deployment,
- configure custom domain,
- enable HTTPS,
- production environment variables,
- TURN deployment,
- logs without sensitive content,
- error monitoring.

## Done when

Two users on unrelated networks can open the public URL and use PeerLink successfully.

---

# Phase 20 — Public Beta

## Goal

Test with real users before adding more features.

## Measure

- connection success rate,
- direct vs TURN percentage,
- time to connect,
- failed authentication,
- transfer failure rate,
- average transfer speed,
- mobile failure rate,
- browser compatibility,
- room abandonment,
- Cloudflare usage,
- TURN bandwidth.

Do not collect message/file content.

## Done when

The core two-person workflow is reliable across common devices and networks.

---

# Recommended Build Order

The most important rule is:

**Do not jump ahead before the previous networking layer works reliably.**

Recommended order:

```text
Phase 0
Project setup
    |
Phase 1
WebRTC connection
    |
Phase 2
Text chat
    |
Phase 3
Shared-secret authentication
    |
Phase 4
Application encryption
    |
Phase 5
Images
    |
Phase 6
Files
    |
Phase 6.5
Compression
    |
Phase 7
Integrity verification
    |
Phase 8
TURN
    |
Phase 9+
UX, persistence, mobile, PWA,
resume, optimization, hardening
```

---

# Minimum Viable Prototype

The first prototype should contain only:

```text
Create room
Share link
Second peer joins
WebRTC connects
Send "Hello"
```

Do not spend time on visual design before this works.

---

# Minimum Viable Product

The first useful public MVP should contain:

```text
✓ Create room
✓ Random invite URL
✓ Maximum two users
✓ Shared-secret authentication
✓ Application encryption
✓ Text chat
✓ Image sharing
✓ Arbitrary file sharing
✓ File accept/decline
✓ Chunked transfer
✓ Progress
✓ Optional compression
✓ SHA-256 verification
✓ STUN
✓ TURN fallback
✓ Responsive mobile interface
✓ No server-side content storage
```

---

# Later / Optional Features

Only consider these after the MVP is stable:

```text
Group rooms
Voice calls
Video calls
Screen sharing
Persistent identities
Contacts
Multiple devices
Offline delivery
Native apps
Browser extension
Encrypted local backups
Temporary message expiration
Custom room expiration
Self-hosted deployment package
```

---

# Development Principle

At every phase, preserve this architecture:

```text
Cloudflare
    |
signaling only
    |
Browser A ================= Browser B
              WebRTC
```

Application content belongs between the peers.

PeerLink infrastructure should help users connect, not become the place where their content lives.
