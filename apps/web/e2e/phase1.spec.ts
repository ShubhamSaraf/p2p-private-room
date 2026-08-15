import { expect, test } from "@playwright/test";

test("two browser pages connect and exchange direct chat messages", async ({ context, page }) => {
  await context.addInitScript(() => {
    const sentFrames: string[] = [];
    Object.defineProperty(window, "__peerLinkSentFrames", { value: sentFrames });
    const originalSend = RTCDataChannel.prototype.send as unknown as (
      this: RTCDataChannel,
      data: string | ArrayBuffer | ArrayBufferView | Blob,
    ) => void;
    RTCDataChannel.prototype.send = function (data: string | ArrayBuffer | ArrayBufferView | Blob) {
      if (typeof data === "string") sentFrames.push(data);
      return originalSend.call(this, data);
    };
  });
  await page.goto("/");
  await expect(page.getByText("Signaling service").locator("..")).toContainText("Connected");

  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for your peer" })).toBeVisible();
  const inviteUrl = page.url();
  expect(inviteUrl).toMatch(/\/r\/[A-Za-z0-9_-]{32}$/);
  await page.getByRole("button", { name: "Show QR" }).click();
  await expect(page.getByAltText("QR code containing only the PeerLink room URL")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );

  const peerPage = await context.newPage();
  await peerPage.goto(inviteUrl);

  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible({ timeout: 20_000 });
  await expect(peerPage.getByRole("heading", { name: "Connected" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Peer connected", { exact: true })).toBeVisible();
  await expect(peerPage.getByText("Peer connected", { exact: true })).toBeVisible();
  await expect(page.getByText("DataChannel open", { exact: true })).toBeVisible();
  await expect(peerPage.getByText("DataChannel open", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.getByLabel("Shared secret").fill("phase three test secret");
  await peerPage.getByLabel("Shared secret").fill("phase three test secret");
  await Promise.all([
    page.getByRole("button", { name: "Verify" }).click(),
    peerPage.getByRole("button", { name: "Verify" }).click(),
  ]);
  await expect(page.getByText("Shared secret verified", { exact: true })).toBeVisible();
  await expect(peerPage.getByText("Shared secret verified", { exact: true })).toBeVisible();

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from the initiator");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Hello from the initiator", { exact: true })).toBeVisible();
  await expect(peerPage.getByText("Hello from the initiator", { exact: true })).toBeVisible();

  const initiatorFrames = await page.evaluate(
    () => (window as unknown as { __peerLinkSentFrames: string[] }).__peerLinkSentFrames,
  );
  expect(initiatorFrames.some((frame) => frame.includes("Hello from the initiator"))).toBe(false);
  expect(
    initiatorFrames.some((frame) => {
      const value: unknown = JSON.parse(frame);
      return (
        typeof value === "object" && value !== null && "type" in value && value.type === "encrypted"
      );
    }),
  ).toBe(true);

  await peerPage
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from the responder");
  await peerPage.getByRole("button", { name: "Send", exact: true }).click();
  await expect(peerPage.getByText("Hello from the responder", { exact: true })).toBeVisible();
  await expect(page.getByText("Hello from the responder", { exact: true })).toBeVisible();

  const fileContents = "encrypted transfer payload ".repeat(4_000);
  await page.locator("#file-picker").setInputFiles({
    name: "phase-6-sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(fileContents),
  });
  await page.getByRole("button", { name: "Send original" }).click();
  const incomingFile = peerPage.locator("article", { hasText: "phase-6-sample.txt" });
  await expect(incomingFile).toContainText("From peer");
  await incomingFile.getByRole("button", { name: "Accept" }).click();
  await expect(incomingFile).toContainText("Verified", { timeout: 20_000 });
  const receivedContents = await incomingFile
    .getByRole("link", { name: /Download/ })
    .evaluate(async (link) =>
      fetch((link as HTMLAnchorElement).href).then((response) => response.text()),
    );
  expect(receivedContents).toBe(fileContents);

  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
    "base64",
  );
  await peerPage.locator("#image-picker").setInputFiles({
    name: "phase-5-image.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await peerPage.getByRole("button", { name: "Send original" }).click();
  const incomingImage = page.locator("article", { hasText: "phase-5-image.png" });
  await incomingImage.getByRole("button", { name: "Accept" }).click();
  await expect(incomingImage).toContainText("Verified", { timeout: 20_000 });
  await expect(incomingImage.getByRole("img", { name: "phase-5-image.png" })).toBeVisible();

  await page.locator("#file-picker").setInputFiles({
    name: "compress-me.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("category,value\npeerlink,1\n".repeat(1_000)),
  });
  await page.getByRole("button", { name: "Compress first" }).click();
  await page.getByRole("button", { name: "Send compressed ZIP" }).click();
  const incomingZip = peerPage.locator("article", { hasText: "compress-me.csv.zip" });
  await incomingZip.getByRole("button", { name: "Accept" }).click();
  await expect(incomingZip).toContainText("Verified", { timeout: 20_000 });

  await page.locator("#file-picker").setInputFiles([
    { name: "batch-a.txt", mimeType: "text/plain", buffer: Buffer.from("batch a") },
    { name: "batch-b.txt", mimeType: "text/plain", buffer: Buffer.from("batch b") },
  ]);
  await page.getByRole("button", { name: "Send batch" }).click();
  for (const name of ["batch-a.txt", "batch-b.txt"]) {
    const incomingBatchFile = peerPage.locator("article", { hasText: name });
    await incomingBatchFile.getByRole("button", { name: "Accept" }).click();
    await expect(incomingBatchFile).toContainText("Verified", { timeout: 20_000 });
  }

  const thirdPage = await context.newPage();
  await thirdPage.goto(inviteUrl);
  await expect(thirdPage.getByRole("heading", { name: "Connection failed" })).toBeVisible();
  await thirdPage.close();

  await peerPage.close();
  await expect(page.getByRole("heading", { name: "Waiting for your peer" })).toBeVisible();
});

test("publishes a local installable app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  const manifest = await page.evaluate(async () =>
    fetch("/manifest.webmanifest").then((response) => response.json()),
  );
  expect(manifest).toMatchObject({ name: "PeerLink Private Room", display: "standalone" });
  const serviceWorker = await page.evaluate(async () =>
    fetch("/sw.js").then((response) => response.text()),
  );
  expect(serviceWorker).toContain("peerlink-shell-v1");
});

test("room controls stay within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Signaling service").locator("..")).toContainText("Connected");
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for your peer" })).toBeVisible();

  const invitePanel = page.getByText("Invite link", { exact: true }).locator("..");
  const connectionPanel = page.getByLabel("Connection status");
  const inviteUrl = invitePanel.locator("p").nth(1);

  await expect(inviteUrl).toHaveCSS("word-break", "break-all");
  await expect(invitePanel).toBeInViewport();
  await expect(connectionPanel).toBeInViewport();

  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  for (const panel of [invitePanel, connectionPanel]) {
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(widths.viewport);
  }

  const connectionBounds = await connectionPanel.boundingBox();
  expect(connectionBounds!.height).toBeLessThan(520);
});

test("different shared secrets keep direct chat locked", async ({ context, page }) => {
  await page.goto("/");
  await expect(page.getByText("Signaling service").locator("..")).toContainText("Connected");
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for your peer" })).toBeVisible();

  const peerPage = await context.newPage();
  await peerPage.goto(page.url());
  await expect(page.getByLabel("Shared secret")).toBeVisible({ timeout: 20_000 });
  await expect(peerPage.getByLabel("Shared secret")).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("Shared secret").fill("initiator secret");
  await peerPage.getByLabel("Shared secret").fill("responder secret");
  await Promise.all([
    page.getByRole("button", { name: "Verify" }).click(),
    peerPage.getByRole("button", { name: "Verify" }).click(),
  ]);

  await expect(page.getByText("Secret mismatch", { exact: true }).first()).toBeVisible();
  await expect(peerPage.getByText("Secret mismatch", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(peerPage.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
});
