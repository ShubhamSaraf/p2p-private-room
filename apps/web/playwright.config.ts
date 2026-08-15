import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "node node_modules/wrangler/bin/wrangler.js dev --config apps/signaling/wrangler.jsonc --port 8787",
      cwd: repositoryRoot,
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4173 --strictPort",
      cwd: repositoryRoot,
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
