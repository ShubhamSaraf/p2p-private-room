# PeerLink — P2P Private Room Architecture Reference

**Project folder / repository name:** `p2p-private-room`  
**Product working name:** **PeerLink**  
**Planned website:** `peerlink.shubhamsaraf.dev`

---

## 1. Product Goal

PeerLink is a browser-based, accountless, temporary private room for exactly two users.

The basic experience:

1. User A opens the website.
2. User A creates a private room.
3. The app generates a random, unguessable room URL.
4. User A shares the room link with User B.
5. Both users enter the same secret passkey.
6. The browsers establish a WebRTC connection.
7. The peers prove that they know the same secret.
8. The room unlocks only after successful authentication.
9. The users can:
   - send text messages,
   - send images,
   - send arbitrary files,
   - optionally compress files locally before sending.
10. Messages and files travel peer-to-peer whenever possible.
11. STUN is used to establish direct connectivity.
12. TURN is used only as a fallback when a direct P2P path is impossible.
13. The signaling infrastructure never stores messages, files, images, or the secret passkey.
14. When the room is closed, the temporary server-side room state disappears.

Core philosophy:

> The link finds the room.  
> The secret authenticates the peers.  
> WebRTC carries the data.  
> The server only introduces the peers.  
> Closing the room destroys the temporary room.

---

# 2. Version 1 Scope

Version 1 should deliberately be limited to **two peers per room**.

Features:

- No signup.
- No accounts.
- No phone number.
- No email requirement.
- Create private room.
- Share room URL.
- Maximum two users.
- Both users enter the same secret.
- Secret is never sent to the signaling server.
- Peer authentication using a proper password-authenticated mechanism.
- WebRTC DataChannel communication.
- STUN-assisted direct P2P.
- TURN fallback.
- Text messaging.
- Image sharing.
- Arbitrary file sharing.
- Large-file chunking.
- File transfer progress.
- File acceptance/decline.
- Optional client-side compression before sending.
- SHA-256 transfer integrity verification.
- Application-layer encryption in addition to WebRTC transport encryption.
- Mobile-responsive UI.
- Temporary rooms.
- No server-side message storage.
- No server-side image storage.
- No server-side file storage.
- Optional local chat history using IndexedDB.
- Visible connection/security status.

Features explicitly postponed:

- Group rooms.
- Accounts.
- Contact lists stored on a server.
- Offline messages.
- Cloud file storage.
- Push notifications.
- Persistent server-side chat history.
- Native Android/iOS apps.
- Voice/video calling.
- Multi-device synchronization.

---

# 3. Recommended Technology Stack

## Frontend

- **TypeScript**
- **React**
- **Vite**
- **Tailwind CSS**

Why:

- WebRTC APIs are native browser APIs and integrate naturally with TypeScript.
- TypeScript provides shared types between the browser and signaling code.
- React handles the user interface without being involved in bulk file transfer.
- Vite gives a simple, fast development and production build process.
- Tailwind makes responsive UI development fast.

---

## Peer-to-Peer Communication

Use the browser's native WebRTC APIs:

- `RTCPeerConnection`
- `RTCDataChannel`
- `RTCSessionDescription`
- `RTCIceCandidate`

The application should use WebRTC primarily for **data**, not audio/video.

Suggested DataChannels:

### `control`

Used for:

- chat messages,
- authentication protocol messages,
- typing state,
- ping/pong,
- file offers,
- file acceptance,
- transfer cancellation,
- metadata,
- protocol control messages.

### `transfer`

Used for:

- images,
- file chunks,
- large binary transfers.

Keeping control traffic separate from bulk transfer traffic prevents a very large file transfer from unnecessarily blocking chat/control operations.

---

# 4. Hosting and Infrastructure

## GitHub

Use GitHub for:

- source control,
- project history,
- issues,
- branches,
- CI/CD,
- backup,
- collaboration.

Suggested repository:

```text
p2p-private-room
```

GitHub does not need to carry user messages or files.

---

## Cloudflare Pages

Use Cloudflare Pages for the production frontend.

Example:

```text
peerlink.shubhamsaraf.dev
```

Cloudflare Pages serves only:

- HTML,
- CSS,
- JavaScript,
- icons,
- static frontend assets.

The frontend itself runs inside the user's browser.

---

## Cloudflare Worker

Use a Cloudflare Worker for:

- room creation,
- WebSocket upgrade,
- routing signaling requests,
- connecting a room URL to a Durable Object.

It should **not** handle:

- user chat contents,
- image contents,
- file contents,
- user passkeys.

---

## Cloudflare Durable Objects

Use **one Durable Object instance per room**.

Example:

```text
Room A -> Durable Object A -> Peer A + Peer B
Room B -> Durable Object B -> Peer C + Peer D
Room C -> Durable Object C -> Peer E + Peer F
```

A room object should contain only temporary state such as:

```text
room ID
creation timestamp
peer A WebSocket
peer B WebSocket
peer presence state
temporary signaling state
```

It must not contain:

```text
messages
images
files
secret passkeys
decryption keys
chat history
```

Use Cloudflare's hibernatable WebSocket design so idle room connections consume minimal resources.

---

# 5. Network Architecture

Normal connection:

```text
                         Cloudflare
                  Worker + Durable Object
                           |
                    signaling only
                           |
             +-------------+-------------+
             |                           |
         Browser A                   Browser B
             |                           |
             +========= WebRTC ==========+
                       Direct P2P
```

The signaling layer exchanges:

- room presence,
- SDP offer,
- SDP answer,
- ICE candidates,
- peer connection state.

Once WebRTC is established, application content should bypass signaling infrastructure.

---

# 6. STUN

STUN assists WebRTC in discovering a viable direct path between peers.

Conceptually:

```text
Browser A ----\
               STUN / ICE discovery
Browser B ----/
        |
        v
direct WebRTC path
```

For early development, a public STUN service can be used.

Later, a project-controlled STUN service can be provided through coturn.

STUN never receives the actual file/message stream.

---

# 7. TURN

TURN is a fallback for situations in which direct WebRTC connectivity cannot be established.

Examples:

- restrictive university networks,
- enterprise firewalls,
- symmetric NAT,
- some mobile carrier networks,
- restrictive hotel/public networks.

Fallback path:

```text
Browser A
    |
 encrypted WebRTC
    |
    v
 TURN relay
    |
 encrypted WebRTC
    |
    v
Browser B
```

TURN relays packets but should not have access to application plaintext.

TURN is the main infrastructure component likely to have meaningful bandwidth cost because it may relay entire file transfers.

For initial development, TURN can be added after direct WebRTC works.

Recommended production implementation:

- **coturn**
- small VPS with public IPv4/IPv6
- hostname such as:

```text
turn.shubhamsaraf.dev
```

---

# 8. Room Creation Workflow

## Step 1 — Create Room

User A clicks:

```text
Create Private Room
```

The browser calls the Cloudflare Worker.

The Worker generates a cryptographically random room ID.

Example:

```text
a7Kc92LmPq4VX8nB
```

The resulting URL could be:

```text
https://peerlink.shubhamsaraf.dev/r/a7Kc92LmPq4VX8nB
```

Room IDs must:

- be random,
- be sufficiently long,
- be difficult to enumerate,
- not contain the secret.

---

## Step 2 — Share Room Link

User A receives:

```text
Private Room Created

https://peerlink.shubhamsaraf.dev/r/a7Kc92LmPq4VX8nB

[ Copy Link ]
[ Show QR Code ]
```

The QR code should encode only the room URL.

The secret must not automatically be embedded into:

- the URL,
- query parameters,
- fragments if avoidable,
- server logs,
- analytics.

---

# 9. Shared Secret / Passkey

Both users must enter the same secret.

Example:

```text
Enter Room Secret

[ ************************ ]

[ Continue ]
```

Important rule:

**The secret is never sent to Cloudflare.**

It remains inside the browser.

Do not implement authentication by sending:

```text
hash(password)
```

to the signaling server.

Do not build a custom password proof protocol.

---

# 10. PAKE Authentication

Use a proper **Password-Authenticated Key Exchange (PAKE)** design.

The purpose is:

- both peers prove knowledge of the same shared secret,
- the password itself is not transmitted,
- an observer cannot simply capture a reusable password hash,
- a cryptographic session key can be established.

Possible protocol families to evaluate before implementation:

- OPAQUE
- SPAKE2
- SPAKE2+
- CPace

The final protocol/library should be chosen after reviewing:

- browser support,
- security maturity,
- WebAssembly availability if required,
- audit history,
- package maintenance,
- bundle size.

Do **not** invent a custom cryptographic handshake.

Conceptual flow:

```text
Browser A                              Browser B

secret                                secret
  |                                     |
  v                                     v
PAKE                                  PAKE
  |                                     |
  +---------- authenticated ------------+
                 exchange
                     |
                     v
             shared session key
```

Only after the shared secret is successfully authenticated should the chat UI become usable.

---

# 11. Application-Layer Encryption

WebRTC DataChannels already provide transport encryption, but PeerLink should add its own application-layer encryption.

Suggested authenticated encryption:

- **AES-256-GCM**

Alternative:

- ChaCha20-Poly1305, if chosen through a suitable mature library.

Conceptually:

```text
plaintext
   |
   v
application encryption
   |
   v
ciphertext
   |
   v
WebRTC / DTLS
   |
   v
network
```

This provides a second layer of protection and allows the application session to be cryptographically tied to the shared-secret authentication.

Do not reuse AES-GCM nonces.

Use a clear key-derivation design that separates keys by purpose, for example:

```text
PAKE output
   |
   +-- chat encryption key
   +-- file encryption key
   +-- authentication/control key
```

Use HKDF if appropriate for key separation.

---

# 12. Security Boundary

The intended model:

```text
Cloudflare signaling  -> cannot read content
STUN server           -> cannot read content
TURN server           -> cannot read plaintext content
ISP                    -> cannot read plaintext content
Wi-Fi operator         -> cannot read plaintext content
network observer       -> sees encrypted traffic
```

Network metadata may still be observable:

- IP addresses in some connection modes,
- approximate traffic volume,
- timing,
- connection duration.

Endpoint compromise remains outside what end-to-end encryption can protect against.

Examples:

```text
malware already installed on user's machine
malicious browser extension
keylogger
remote access malware
compromised operating system
```

However, vulnerabilities caused by Veil itself remain the project's responsibility:

- XSS,
- dependency compromise,
- unsafe cryptography,
- leaked deployment credentials,
- malicious frontend deployment,
- key leakage,
- insecure random number generation.

---

# 13. Chat Protocol

Create a typed application protocol.

Example TypeScript shape:

```ts
type ChatMessage = {
  type: "chat";
  id: string;
  timestamp: number;
  text: string;
};
```

Other control messages could include:

```ts
type ControlMessage =
  | ChatMessage
  | FileOffer
  | FileAccept
  | FileDecline
  | TransferCancel
  | TransferProgress
  | PingMessage
  | PongMessage;
```

Before sending:

```text
object
  |
serialize
  |
encrypt
  |
RTCDataChannel
```

Receiver:

```text
RTCDataChannel
  |
decrypt
  |
validate
  |
deserialize
  |
render
```

Use runtime schema validation for untrusted incoming messages.

Potential library:

- `zod`

This prevents malformed peer messages from being blindly trusted.

---

# 14. File Transfer Design

Files must be transferred in chunks.

Never:

```text
load entire 20 GB file into RAM
```

Instead:

```text
File
 |
 +-- chunk 1
 +-- chunk 2
 +-- chunk 3
 +-- chunk 4
 +-- ...
```

Initial chunk size to benchmark:

```text
64 KiB - 256 KiB
```

Do not permanently hard-code the first value chosen. Measure performance across:

- Chrome desktop,
- Firefox desktop,
- Safari,
- Android Chrome,
- iPhone Safari,
- direct LAN,
- normal Internet,
- TURN relay.

Use binary payloads such as:

- `ArrayBuffer`
- `Uint8Array`

Avoid Base64 because it increases payload size and adds unnecessary encoding/decoding overhead.

---

# 15. WebRTC Backpressure

The transfer engine must use:

```text
RTCDataChannel.bufferedAmount
```

and:

```text
RTCDataChannel.bufferedAmountLowThreshold
```

The sender should pause reading new chunks when the DataChannel buffer becomes too large.

Example logic:

```text
read chunk
   |
   v
buffer below threshold?
   | yes
   v
send
   |
   v
repeat
```

If buffer is too large:

```text
pause reads
   |
wait for bufferedamountlow
   |
resume
```

Without flow control, fast senders can overwhelm memory or create unstable performance, especially on mobile devices.

---

# 16. File Offer Workflow

Before transferring file data, send metadata.

Example:

```json
{
  "type": "file-offer",
  "id": "f28471",
  "name": "research-data.zip",
  "size": 5046586572,
  "mime": "application/zip"
}
```

Receiver sees:

```text
Peer wants to send:

research-data.zip
4.7 GB

[ Decline ]    [ Accept ]
```

No file data should be transferred until the receiver accepts.

---

# 17. File Transfer Progress

Display:

```text
research-data.zip

████████████████░░░░░░
72%

3.38 GB / 4.70 GB
32.8 MB/s
1m 04s remaining

[ Cancel ]
```

Track:

- bytes sent,
- bytes received,
- current speed,
- moving-average speed,
- elapsed time,
- estimated remaining time.

Later features:

- pause,
- resume,
- retry,
- transfer recovery.

---

# 18. File Integrity

Use **SHA-256** to verify that the received file matches the sender's file.

Conceptually:

```text
Sender file
   |
SHA-256
   |
digest
```

Receiver:

```text
received file
   |
SHA-256
   |
digest
```

If digests match:

```text
✓ File verified
```

If they do not:

```text
⚠ File integrity check failed
```

For very large files, hashing should be designed to avoid loading the entire file into RAM.

---

# 19. Optional File Compression

Before sending, the sender should be given a choice:

```text
Send File

project-data.csv
2.4 GB

○ Send original
  Starts immediately
  2.4 GB

○ Compress before sending
  Compression runs locally
  Estimated savings: calculating...

[ Cancel ]    [ Send ]
```

Compression happens entirely in the sender's browser.

Workflow:

```text
Select file
   |
   +---- Original -------------------+
   |                                 |
   |                                 v
   |                          Transfer Manager
   |
   +---- Compress
             |
             v
      Compression Worker
             |
             v
       compressed Blob
             |
             v
       Transfer Manager
```

---

# 20. Compression Worker

Large compression tasks must run outside the React/main browser thread.

Use a **Web Worker**.

Architecture:

```text
React UI
   |
   v
Web Worker
   |
compress
   |
   v
Blob / stream
   |
   v
Transfer Manager
```

This prevents the page from becoming unresponsive.

Initial compression option:

- ZIP

Possible libraries to evaluate:

- `fflate`
- `zip.js`

Choose based on:

- streaming support,
- browser compatibility,
- worker support,
- performance,
- package size,
- maintenance quality.

Do not automatically recompress already-compressed media unless the user explicitly chooses to do so.

Formats likely to have little benefit from ZIP recompression:

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.mp4`
- `.mkv`
- `.mp3`
- `.aac`
- `.zip`
- `.7z`
- many PDFs

Formats more likely to compress well:

- `.txt`
- `.csv`
- `.json`
- `.xml`
- `.log`
- source-code files
- uncompressed raw data
- collections of many small files

Show a warning when compression is unlikely to help.

---

# 21. Multiple Files / Folder Transfer

Later, allow:

```text
file 1
file 2
file 3
folder
```

to become:

```text
bundle.zip
```

and send the archive.

Do not automatically extract received archives in the initial implementation.

Receiver should receive:

```text
bundle.zip
```

Later optional feature:

```text
[ Save ZIP ]
[ Extract locally ]
```

---

# 22. Mobile Considerations

WebRTC works well in modern browsers, but mobile browsers impose additional constraints.

Important limitations:

- browser tabs may be suspended,
- phones may kill background tabs,
- locking the device may pause transfers,
- very large in-memory Blobs can cause memory pressure,
- iOS browser behavior can be more restrictive.

The UI should display during transfers:

```text
Keep this page open until the transfer finishes.
```

Do not promise reliable transfers while the browser is backgrounded.

A PWA can be added later for a more app-like experience, but it does not remove every mobile OS background restriction.

---

# 23. Local Storage

Use **IndexedDB** for optional client-side data.

Possible local data:

- local chat history,
- recent room metadata,
- preferences,
- incomplete transfer metadata.

Do not store shared secrets in plaintext.

Privacy-oriented setting:

```text
Save chats locally
[ OFF ]
```

Could default to OFF.

Provide:

```text
Clear local history
```

---

# 24. Room Lifecycle

Suggested room lifecycle:

```text
room created
   |
peer A joins
   |
peer B joins
   |
WebRTC established
   |
authenticated
   |
active session
   |
both peers leave
   |
grace period
   |
room destroyed
```

Possible grace period:

```text
5 minutes
```

This permits short accidental disconnects.

Also consider a maximum room lifetime, for example:

```text
24 hours
```

Exact values can be configurable later.

---

# 25. Connection Status UI

Expose how the connection works.

Direct connection:

```text
● Connected

🔒 Shared secret verified
🔐 End-to-end encryption active
⚡ Direct peer-to-peer
🌐 STUN/ICE connection
↪ TURN not in use
```

TURN:

```text
● Connected

🔒 Shared secret verified
🔐 End-to-end encryption active
↪ TURN relay active
```

Privacy panel:

```text
Server Storage

Messages       None
Images         None
Files          None
Passkey        None
Chat History   None
```

Avoid claims such as:

```text
unhackable
impossible to intercept
100% anonymous
```

Use precise security language.

---

# 26. Suggested Repository Structure

```text
p2p-private-room/
|
├── apps/
│   |
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ChatWindow.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── FileCard.tsx
│   │   │   │   ├── ImageMessage.tsx
│   │   │   │   ├── TransferProgress.tsx
│   │   │   │   ├── ConnectionStatus.tsx
│   │   │   │   └── PasskeyDialog.tsx
│   │   │   |
│   │   │   ├── hooks/
│   │   │   │   ├── useWebRTC.ts
│   │   │   │   ├── useRoom.ts
│   │   │   │   └── useTransfer.ts
│   │   │   |
│   │   │   ├── workers/
│   │   │   │   ├── compression.worker.ts
│   │   │   │   └── hashing.worker.ts
│   │   │   |
│   │   │   ├── pages/
│   │   │   └── main.tsx
│   │   |
│   │   ├── public/
│   │   ├── index.html
│   │   └── package.json
│   |
│   └── signaling/
│       ├── src/
│       │   ├── worker.ts
│       │   ├── room.ts
│       │   ├── websocket.ts
│       │   └── protocol.ts
│       |
│       ├── wrangler.jsonc
│       └── package.json
|
├── packages/
│   |
│   ├── protocol/
│   │   ├── src/
│   │   │   ├── signaling.ts
│   │   │   ├── control.ts
│   │   │   └── transfer.ts
│   │   └── package.json
│   |
│   ├── webrtc/
│   │   ├── src/
│   │   │   ├── peer.ts
│   │   │   ├── ice.ts
│   │   │   ├── dataChannels.ts
│   │   │   └── connectionState.ts
│   │   └── package.json
│   |
│   ├── crypto/
│   │   ├── src/
│   │   │   ├── pake.ts
│   │   │   ├── keys.ts
│   │   │   ├── encryption.ts
│   │   │   └── nonces.ts
│   │   └── package.json
│   |
│   ├── transfer/
│   │   ├── src/
│   │   │   ├── sender.ts
│   │   │   ├── receiver.ts
│   │   │   ├── chunking.ts
│   │   │   ├── backpressure.ts
│   │   │   ├── integrity.ts
│   │   │   └── compression.ts
│   │   └── package.json
│   |
│   └── storage/
│       ├── src/
│       │   └── indexedDb.ts
│       └── package.json
|
├── infrastructure/
│   ├── cloudflare/
│   │   └── README.md
│   |
│   └── coturn/
│       ├── turnserver.conf.example
│       └── README.md
|
├── docs/
│   ├── protocol.md
│   ├── security-model.md
│   └── architecture.md
|
├── package.json
├── tsconfig.json
└── README.md
```

A monorepo tool such as npm workspaces or pnpm workspaces can be used.

For simplicity, start with:

- npm workspaces

or, if preferred later:

- pnpm workspaces.

---

# 27. Libraries / APIs Needed

## Required core platform APIs

Prefer native browser APIs whenever possible:

- WebRTC
- WebSocket
- Web Crypto API
- Web Workers
- IndexedDB
- File API
- Blob
- Streams API where useful
- `crypto.getRandomValues()`

---

## Frontend libraries

Recommended:

```text
react
react-dom
typescript
vite
tailwindcss
```

Optional:

```text
zod
```

for runtime validation.

Potential UI/icon library:

```text
lucide-react
```

Optional router:

```text
react-router-dom
```

A router may not be necessary if the app is small and routes are simple.

---

## Cloudflare tooling

Recommended:

```text
wrangler
@cloudflare/workers-types
```

Use:

- Cloudflare Workers
- Durable Objects
- Hibernatable WebSockets
- Cloudflare Pages

---

## Compression libraries to evaluate

Do not install both permanently unless needed.

Candidates:

```text
fflate
@zip.js/zip.js
```

Benchmark before deciding.

---

## Cryptography libraries

Use native **Web Crypto API** for:

- AES-GCM
- SHA-256
- HKDF
- secure random values

For PAKE, select a mature dedicated implementation after evaluation.

Do not implement PAKE primitives manually.

---

# 28. Coding Principles

## Keep networking separate from UI

React should never manage individual file chunks directly.

Correct architecture:

```text
React UI
   |
   v
TransferManager
   |
   v
RTCDataChannel
```

React receives summarized state such as:

```text
72%
32 MB/s
1 minute remaining
```

rather than every chunk.

---

## Avoid unnecessary copying

Large-file performance depends heavily on memory copying.

Prefer:

- `ArrayBuffer`
- `Uint8Array`
- streaming/chunked reads

Avoid:

- Base64
- giant strings
- whole-file buffering
- repeated Blob reconstruction.

---

## Keep protocol versioned

Every connection should identify a protocol version.

Example:

```text
PEERLINK_PROTOCOL_VERSION = 1
```

If two browsers use incompatible versions:

```text
This room uses an incompatible version of Veil.
Please refresh or update.
```

This will become important when deployments change while someone has an old browser tab open.

---

# 29. Development Workflow

## Phase 0 — Project Setup

Create:

```text
p2p-private-room/
```

Initialize:

- Git repository,
- TypeScript,
- React/Vite frontend,
- Cloudflare Worker,
- Durable Object binding,
- shared package structure.

Goal:

```text
frontend loads
worker responds
```

---

# 30. Phase 1 — Connection Only

Build only:

```text
Create room
     |
Copy URL
     |
second browser joins
     |
two WebSockets connect
     |
Durable Object pairs users
     |
exchange SDP
     |
exchange ICE
     |
WebRTC DataChannel opens
     |
Connected
```

No passkey.

No encryption layer.

No chat UI.

No files.

Goal:

```text
Browser A: Connected
Browser B: Connected
```

Test:

- two Chrome tabs,
- Chrome + Firefox,
- two different computers,
- phone + computer,
- separate networks.

---

# 31. Phase 2 — Basic Chat

Add:

```text
control DataChannel
```

Send:

```text
Hello
```

between peers.

Build:

- message input,
- send button,
- basic message bubbles.

Goal:

```text
A -> B
B -> A
```

with Cloudflare not carrying the messages.

---

# 32. Phase 3 — Shared Secret Authentication

Add:

```text
PasskeyDialog
```

Both peers enter the same secret.

Implement a proper PAKE.

Chat remains locked until authentication succeeds.

States:

```text
Waiting for peer
Peer connected
Waiting for secret
Authenticating
Verified
Authentication failed
```

Never send the secret to the Worker.

---

# 33. Phase 4 — Application Encryption

Derive session keys from the authenticated session.

Add AES-GCM encryption to all application messages.

All control-channel payloads should become encrypted envelopes.

Example conceptual packet:

```text
version
message type / envelope metadata
nonce
ciphertext
authentication tag
```

Do not expose sensitive plaintext metadata unnecessarily.

---

# 34. Phase 5 — Image Transfer

Implement:

```text
choose image
     |
send image offer
     |
receiver accepts
     |
chunk image
     |
transfer
     |
reconstruct
     |
display preview
```

Goal:

- JPEG,
- PNG,
- WebP,
- GIF if desired.

Use Object URLs for local preview.

Revoke URLs when no longer needed.

---

# 35. Phase 6 — Arbitrary File Transfer

Implement:

- metadata,
- accept/decline,
- chunking,
- backpressure,
- progress,
- cancellation,
- SHA-256 verification.

Test:

```text
1 KB
1 MB
100 MB
1 GB+
```

Do not begin testing only with huge files.

---

# 36. Phase 6.5 — Compression

Add:

```text
Send original
or
Compress first
```

Compression happens locally in a Web Worker.

Show:

- compression progress,
- original size,
- resulting size,
- percentage saved,
- cancel compression.

Example:

```text
Original:     1.80 GB
Compressed:   812 MB
Saved:        55.9%

[ Send compressed ]
```

If compression increases size, show:

```text
Compression did not reduce this file.

Original:  850 MB
ZIP:       854 MB

Recommended: Send original
```

---

# 37. Phase 7 — TURN

Deploy coturn.

Add TURN credentials.

ICE strategy:

```text
host candidates
      |
server-reflexive candidates via STUN
      |
relay candidates via TURN
```

Prefer direct path.

Use TURN only when ICE selects it.

Display whether the selected path is:

```text
Direct
Relay
```

Test from:

- home Wi-Fi,
- cellular network,
- university Wi-Fi,
- restrictive networks.

---

# 38. Phase 8 — Local Persistence

Add optional IndexedDB storage.

Possible settings:

```text
Save chat history locally     OFF
Remember recent rooms         OFF
Remember UI preferences       ON
```

Never silently store the shared passkey.

---

# 39. Phase 9 — UX / PWA

Add:

- responsive layout,
- QR invite,
- drag-and-drop,
- installable PWA,
- offline shell,
- better transfer status,
- reconnect UI,
- connection diagnostics,
- accessibility improvements.

---

# 40. Future Resume Support

Pause/resume is more complicated than ordinary chunking.

Future transfer protocol should consider:

```text
transfer ID
chunk number
byte range
completed range map
file digest
```

If a connection drops:

```text
reconnect
   |
authenticate again
   |
compare transfer state
   |
resume missing chunks
```

This should come after reliable basic transfer.

---

# 41. Security Checklist

Before calling the product secure:

- [ ] HTTPS enforced.
- [ ] Strong CSP configured.
- [ ] No inline untrusted script execution.
- [ ] No user-generated HTML inserted unsafely.
- [ ] Dependency versions reviewed.
- [ ] Automated dependency alerts enabled.
- [ ] Cryptographically random room IDs.
- [ ] No secret in URLs.
- [ ] No secret logged.
- [ ] No analytics capturing sensitive values.
- [ ] Mature PAKE implementation.
- [ ] Proper key separation.
- [ ] AES-GCM nonces never reused with the same key.
- [ ] Incoming protocol messages validated.
- [ ] File names treated as untrusted text.
- [ ] File MIME types treated as untrusted.
- [ ] Object URLs revoked.
- [ ] WebRTC connection state handled safely.
- [ ] Room capacity strictly limited to two peers in V1.
- [ ] TURN credentials protected and rotated.
- [ ] No permanent server-side room content.
- [ ] Deployment credentials secured.
- [ ] Production build dependencies locked.
- [ ] Security claims accurately describe the actual implementation.

---

# 42. Privacy Model

PeerLink should state clearly:

### Stored by PeerLink servers

```text
Messages       No
Files          No
Images         No
Secret         No
Chat history   No
```

### Temporarily observable by infrastructure

Depending on implementation:

```text
room ID
connection timing
WebSocket connection
IP/network metadata
ICE signaling data
```

Do not claim total anonymity.

---

# 43. Performance Principles

The programming language is not likely to be the transfer bottleneck.

The main performance factors are:

```text
sender upload speed
receiver download speed
network route
direct vs TURN
WebRTC/SCTP behavior
chunk size
backpressure
disk/file reading
browser memory limits
compression speed
encryption overhead
```

TypeScript is appropriate because actual network transport and cryptographic primitives are implemented by browser/native runtime code.

Performance priorities:

1. binary transfer,
2. no Base64,
3. chunked reading,
4. controlled buffering,
5. background compression/hashing,
6. minimal memory copies,
7. avoid React updates per chunk,
8. benchmark real devices.

---

# 44. Initial Cost Strategy

Start with:

```text
GitHub                    free
Cloudflare Pages          free
Cloudflare Worker         free tier
Durable Objects           free tier
Public STUN               free
TURN                      add later
```

This allows Phase 1 through most core development to begin without purchasing server infrastructure.

TURN becomes the first likely paid infrastructure component once reliable fallback connectivity is required.

---

# 45. Suggested Domain Layout

```text
peerlink.shubhamsaraf.dev
    frontend

signal.shubhamsaraf.dev
    signaling Worker endpoint

turn.shubhamsaraf.dev
    TURN/STUN server later
```

The Worker endpoint can also live behind the main domain if preferred.

---

# 46. End-to-End User Workflow

Final intended user experience:

```text
Open PeerLink
   |
   v
Create Private Room
   |
   v
Receive random room URL
   |
   v
Share URL with second person
   |
   v
Both join
   |
   v
Both enter shared secret
   |
   v
WebRTC negotiation
   |
   v
STUN tries direct connection
   |
   +---- Direct works ------+
   |                        |
   |                        v
   |                    Direct P2P
   |
   +---- Direct fails
            |
            v
         TURN relay
            |
            v
      PAKE authentication
            |
            v
      shared secret verified
            |
            v
      derive session keys
            |
            v
     encrypted room unlocked
            |
     +------+------+------+
     |             |      |
     v             v      v
   Chat         Images   Files
                         |
                    choose original
                         or
                      compress
                         |
                         v
                  chunked transfer
                         |
                         v
                    SHA-256 verify
```

---

# 47. First Coding Milestone

Do not begin with encryption, compression, or large files.

The first milestone is exactly:

```text
Browser A
   |
Create Room
   |
Cloudflare Worker
   |
Durable Object
   |
Browser B joins
   |
SDP / ICE exchanged
   |
RTCDataChannel opens
   |
Browser A displays CONNECTED
Browser B displays CONNECTED
```

Once this works reliably, move to Phase 2.

---

# 48. Reference Summary

### Project

```text
p2p-private-room
```

### Product

```text
PeerLink
```

### Website

```text
peerlink.shubhamsaraf.dev
```

### Language

```text
TypeScript
```

### UI

```text
React + Vite + Tailwind CSS
```

### Direct communication

```text
WebRTC RTCDataChannel
```

### Signaling

```text
Cloudflare Worker + Durable Objects + WebSockets
```

### NAT traversal

```text
ICE + STUN
```

### Relay fallback

```text
TURN / coturn
```

### Authentication

```text
PAKE using shared passkey
```

### Application encryption

```text
AES-256-GCM
```

### Key derivation/separation

```text
PAKE-derived secret + HKDF where appropriate
```

### File integrity

```text
SHA-256
```

### Local storage

```text
IndexedDB
```

### Compression

```text
Web Worker + ZIP
fflate or zip.js to evaluate
```

### Server storage

```text
No messages
No images
No user files
No passkeys
```

### V1 room size

```text
2 peers
```

---

## Final Design Principle

PeerLink should remain a **connection service rather than a content-hosting service**.

Cloudflare helps two browsers discover each other.

The shared secret authenticates the humans/peers.

WebRTC establishes the network path.

The browsers encrypt and exchange the content.

STUN makes direct connections possible.

TURN provides reliability when direct connectivity fails.

The server should never become the normal path for messages or files.
