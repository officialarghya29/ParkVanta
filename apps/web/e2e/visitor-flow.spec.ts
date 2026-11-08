import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const PASSWORD = "ParkVanta@2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
}

test("resident issues a pass; guard authorizes entry, confirms and releases the slot", async ({
  browser,
}) => {
  const guest = `E2E Guest ${Date.now()}`;
  const plate = "KA09E2E1234";

  const residentContext = await browser.newContext();
  const resident = await residentContext.newPage();
  await signIn(resident, "resident@skyline.dev");
  await expect(resident).toHaveURL(/\/resident$/);
  expect(await resident.evaluate(() => localStorage.getItem("parkvanta.session"))).toBeNull();
  await resident.reload();
  await expect(resident).toHaveURL(/\/resident$/);

  await resident.getByTestId("visitor-name").fill(guest);
  await resident.getByTestId("vehicle-registration").fill(plate);
  await resident.getByTestId("create-invitation").click();
  await expect(resident.getByText(guest).first()).toBeVisible();

  await resident.getByTestId("approve-invitation").first().click();
  const passUrl = (await resident.getByTestId("pass-url").textContent())?.trim();
  expect(passUrl).toContain("/pass/");
  await expect(resident.getByText(guest).first()).toBeVisible();

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(passUrl!);
  await expect(visitor.getByTestId("pass-qr")).toBeVisible();
  await expect(visitor.getByText(guest)).toBeVisible();

  const guardContext = await browser.newContext();
  const guard = await guardContext.newPage();
  await signIn(guard, "guard@skyline.dev");
  await expect(guard).toHaveURL(/\/guard$/);

  await guard.getByTestId("guard-token").fill(passUrl!);
  await guard.getByTestId("guard-verify").click();
  await expect(guard.getByTestId("guard-authorize")).toBeVisible();
  await guard.getByTestId("guard-authorize").click();
  await guard.getByTestId("guard-confirm-entry").click();
  await expect(guard.getByText(/is now OCCUPIED/)).toBeVisible();
  await expect(guard.getByText(guest).first()).toBeVisible();

  // Network loss: entry verification locks, but the exit is queued locally.
  await guardContext.setOffline(true);
  await expect(guard.getByTestId("offline-banner")).toBeVisible();
  await expect(guard.getByTestId("guard-verify")).toBeDisabled();
  await guard.getByTestId("guard-exit").first().click();
  await expect(guard.getByTestId("offline-sync-result")).toContainText(/queued/i);
  await expect(guard.getByText("No vehicles inside")).toBeVisible();
  expect(await guard.evaluate(() => localStorage.getItem("parkvanta.gate.queue.v1"))).toBeNull();

  // Restoring the connection replays the queue exactly once.
  await guardContext.setOffline(false);
  await expect(guard.getByTestId("offline-sync-result")).toContainText(/Synced/i, {
    timeout: 20_000,
  });
  await expect(guard.getByText("No vehicles inside")).toBeVisible();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, "admin@skyline.dev");
  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.getByTestId("overview")).toBeVisible();
  await expect(admin.getByTestId("overview")).toContainText("Total capacity");

  await residentContext.close();
  await visitorContext.close();
  await guardContext.close();
  await adminContext.close();
});
