import { expect, test } from "@playwright/test";

test("two browser pages establish the PeerLink control DataChannel", async ({ context, page }) => {
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

  const thirdPage = await context.newPage();
  await thirdPage.goto(inviteUrl);
  await expect(thirdPage.getByRole("heading", { name: "Connection failed" })).toBeVisible();
  await thirdPage.close();

  await peerPage.close();
  await expect(page.getByRole("heading", { name: "Waiting for your peer" })).toBeVisible();
});
