# Phase 0 — Project foundation

## Implemented

- npm workspaces for the frontend, signaling service, and shared protocol
- React 19 + TypeScript + Vite frontend
- Tailwind CSS through its Vite plugin
- Cloudflare Worker with a SQLite-backed Durable Object binding
- shared signaling protocol types imported by both applications
- local environment examples without committed secrets
- ESLint, Prettier, TypeScript checks, Vitest, and production builds

## Local acceptance test

1. Run `npm install`.
2. Run `npm run dev:signaling`.
3. In another terminal, run `npm run dev:web`.
4. Open `http://localhost:5173` and confirm the signaling status becomes **Connected**.
5. Open `http://localhost:8787/health` and confirm a JSON response with `status: "ok"`.
6. Open `http://localhost:8787/debug/rooms/local-test` and confirm `durableObject.status` is `"ready"`. This proves the Worker can resolve and invoke its Durable Object binding.
7. Run `npm run check`.

The `/debug/rooms/:roomId` endpoint is a Phase 0 diagnostic and will be removed or replaced by the room API in Phase 1.

## Environment files

The web app reads `VITE_SIGNALING_URL`. Copy `apps/web/.env.example` to `apps/web/.env.local` only when overriding the local default.

The Worker reads `APP_ORIGIN`; the deployable configuration uses `https://peerlink.shubhamsaraf.dev`. When the Worker itself runs on localhost, it also permits a localhost frontend origin. This value is not a secret.

## Cloudflare deployment (user action)

1. Create or sign in to a Cloudflare account and enable a `workers.dev` subdomain.
2. From this repository run `npx wrangler login` and finish the browser authorization.
3. Run `npm run deploy --workspace @peerlink/signaling`.
4. Record the resulting `https://<worker>.<subdomain>.workers.dev` URL.
5. Set `VITE_SIGNALING_URL` to that URL when configuring the Pages project later.

The first Worker deployment creates the SQLite-backed `Room` Durable Object namespace via the `v1` migration in `apps/signaling/wrangler.jsonc`. No database, KV namespace, or manually created Durable Object is required.

GitHub repository creation and Cloudflare Pages are intentionally left as user-owned account actions. If you want a foundation preview now, connect the GitHub repository to Pages with:

- production branch: `main`
- build command: `npm run build --workspace @peerlink/web`
- build output directory: `apps/web/dist`
- environment variable: `VITE_SIGNALING_URL=<your deployed Worker URL>`

The Pages deployment becomes functionally useful once Phase 1 supplies an end-to-end room flow.
