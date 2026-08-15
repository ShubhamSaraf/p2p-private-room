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

  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
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
  await page.getByRole("button", { name: "Send" }).click();
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
  await peerPage.getByRole("button", { name: "Send" }).click();
  await expect(peerPage.getByText("Hello from the responder", { exact: true })).toBeVisible();
  await expect(page.getByText("Hello from the responder", { exact: true })).toBeVisible();

  const thirdPage = await context.newPage();
  await thirdPage.goto(inviteUrl);
  await expect(thirdPage.getByRole("heading", { name: "Connection failed" })).toBeVisible();
  await thirdPage.close();

  await peerPage.close();
  await expect(page.getByRole("heading", { name: "Waiting for your peer" })).toBeVisible();
});

test("different shared secrets keep direct chat locked", async ({ context, page }) => {
  await page.goto("/");
  await expect(page.getByText("Signaling service").locator("..")).toContainText("Connected");
  await page.getByRole("button", { name: "Create private room" }).click();

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
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(peerPage.getByRole("button", { name: "Send" })).toBeDisabled();
});
