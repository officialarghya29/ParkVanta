import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../../docs/assets");
const APP = process.env.CAPTURE_APP_URL ?? "http://127.0.0.1:5173";
const API = process.env.CAPTURE_API_URL ?? "http://127.0.0.1:8091/api/v1";
const PASSWORD = "ParkVanta@2026";

fs.mkdirSync(OUT, { recursive: true });

async function request(route, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${route} → ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function apiLogin(email) {
  const login = await request("/auth/login", {
    method: "POST",
    body: { email, password: PASSWORD },
  });
  return { token: login.access_token, user: login.user };
}

function at(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

let phoneSequence = 9000000000;

async function createInvitation(token, { name, plate = null, type = "GUEST", minutes = 20 }) {
  return request("/invitations", {
    method: "POST",
    token,
    body: {
      visitor_name: name,
      visitor_phone: String(++phoneSequence),
      vehicle_registration: plate,
      vehicle_category: "FOUR_WHEELER",
      visitor_type: type,
      purpose: "Documented demo scenario",
      expected_arrival: at(minutes),
      expected_departure: at(minutes + 180),
    },
  });
}

async function approve(token, invitationId) {
  return request(`/invitations/${invitationId}/approve`, { method: "POST", token });
}

async function enter(token, passToken, plate) {
  const verify = await request("/qr/verify", {
    method: "POST",
    token,
    body: { token: passToken, plate_number: plate },
  });
  if (!verify.allowed) throw new Error(`Pass not allowed: ${verify.reason_code}`);
  const authorization = await request("/gate/entry/authorize", {
    method: "POST",
    token,
    body: { token: passToken, plate_number: plate },
  });
  const confirmation = await request("/gate/entry/confirm", {
    method: "POST",
    token,
    body: { invitation_id: authorization.invitation_id },
  });
  return { authorization, confirmation };
}

async function uiLogin(page, email, expectedPath) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(new RegExp(`${expectedPath}$`));
}

async function settle(page, ms = 900) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function shoot(page, file, fullPage = true) {
  await page.screenshot({ path: path.join(OUT, file), fullPage });
  console.log(`captured ${file}`);
}

const resident = await apiLogin("resident@skyline.dev");
const guard = await apiLogin("guard@skyline.dev");
const admin = await apiLogin("admin@skyline.dev");

// Live visit: confirmed entry, slot occupied.
const activeInvite = await createInvitation(resident.token, {
  name: "Aarav Mehta",
  plate: "KA05MN4421",
});
const activeApproval = await approve(resident.token, activeInvite.id);
await enter(guard.token, activeApproval.pass_token, "KA05MN4421");

// Completed visit: populates history, analytics and gate activity.
const completed = await createInvitation(resident.token, {
  name: "Rohit Verma",
  plate: "KA01XY9087",
  minutes: 40,
});
const completedApproval = await approve(resident.token, completed.id);
await enter(guard.token, completedApproval.pass_token, "KA01XY9087");
await request("/gate/exit/confirm", {
  method: "POST",
  token: guard.token,
  body: { invitation_id: completed.id },
});

// Reserved, not yet at the gate — used for the guard verdict panel.
const reserved = await createInvitation(resident.token, {
  name: "Neha Kapoor",
  plate: "KA03PV7712",
  minutes: 30,
});
const reservedApproval = await approve(resident.token, reserved.id);

// Pending and rejected states for the resident queue.
await createInvitation(resident.token, { name: "Priya Nair", type: "DELIVERY" });
const rejected = await createInvitation(resident.token, {
  name: "Unverified Caller",
  type: "BUSINESS",
});
await request(`/invitations/${rejected.id}/reject`, {
  method: "POST",
  token: resident.token,
  body: { reason: "Resident did not recognise this visitor" },
});

const browser = await chromium.launch({ channel: "chrome" });

const residentContext = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 2,
});
const residentPage = await residentContext.newPage();
await uiLogin(residentPage, "resident@skyline.dev", "/resident");
await residentPage.getByTestId("create-invitation").waitFor();
await settle(residentPage);
await shoot(residentPage, "screenshot-resident.png");

const guardContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
const guardPage = await guardContext.newPage();
await uiLogin(guardPage, "guard@skyline.dev", "/guard");
await guardPage.getByTestId("guard-token").waitFor();
await guardPage
  .getByTestId("guard-token")
  .fill(`${APP}/pass/${reservedApproval.pass_token}`);
await guardPage.getByTestId("guard-verify").click();
await guardPage.getByTestId("guard-authorize").waitFor();
await settle(guardPage);
await shoot(guardPage, "screenshot-guard.png");

const adminContext = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
});
const adminPage = await adminContext.newPage();
await uiLogin(adminPage, "admin@skyline.dev", "/admin");
await adminPage.getByTestId("overview").waitFor();
await settle(adminPage, 1400);
await shoot(adminPage, "screenshot-admin.png");

await adminPage.goto(`${APP}/admin/inventory`, { waitUntil: "networkidle" });
await adminPage.getByTestId("inventory-page").waitFor();
await settle(adminPage);
await shoot(adminPage, "screenshot-inventory.png");

const visitorContext = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  isMobile: true,
});
const visitorPage = await visitorContext.newPage();
await visitorPage.goto(`${APP}/pass/${activeApproval.pass_token}`, {
  waitUntil: "networkidle",
});
await visitorPage.getByTestId("pass-qr").waitFor();
await settle(visitorPage);
await shoot(visitorPage, "screenshot-pass.png");

await browser.close();
console.log(`assets written to ${OUT}`);
