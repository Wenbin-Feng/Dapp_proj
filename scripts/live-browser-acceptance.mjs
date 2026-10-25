// Real production HTTP/Auth/UI checks with disposable QA signing accounts.
// No business or Supabase response interception, private keys in Node only.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { hexToString } from "viem";
import sharp from "sharp";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (!args.includes("--live")) throw new Error("Live browser writes require --live and --app-url.");
const APP = new URL(option("--app-url", "")).origin;
const run = option("--run", "2026-10-25");
if (!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)?$/.test(run)) throw new Error("Invalid QA run name.");
const directory = resolve("tmp/live-acceptance", run);
await mkdir(`${directory}/screenshots`, { recursive: true });
const journal = JSON.parse(await readFile(`${directory}/private.json`, "utf8"));
const results = [];
const failures = [];
const contexts = [];
const browser = await chromium.launch({ headless: true, ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const report = () => writeFile(`${directory}/browser-report.json`, JSON.stringify({ app: APP, run, checkedAt: new Date().toISOString(), results }, null, 2));
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); results.push({ name, status: "passed", milliseconds: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: "failed", error: error.message.slice(0, 1200) }); console.log(`FAIL ${name}: ${error.message.slice(0, 500)}`); failures.push(name); }
  finally { await report(); }
}
async function walletPage(name, { cancellation = false } = {}) {
  const account = privateKeyToAccount(journal.actors[name].privateKey);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  contexts.push(context);
  await context.exposeBinding("qaWalletRequest", async (_source, { method, params }) => {
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account.address];
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "personal_sign") {
      const message = hexToString(params[0]);
      assert.ok(message.includes(new URL(APP).host) && message.includes("This request does not send a transaction."));
      assert.equal(params[1].toLowerCase(), account.address.toLowerCase());
      return account.signMessage({ message: { raw: params[0] } });
    }
    throw new Error("Live QA wallet signs login messages only; no public-chain transactions.");
  });
  await context.addInitScript(({ cancellation }) => {
    const listeners = new Map();
    let cancelNext = cancellation;
    const provider = {
      isMetaMask: true,
      async request(request) {
        if (request.method === "personal_sign" && cancelNext) {
          cancelNext = false;
          throw Object.assign(new Error("QA user cancelled the signature"), { code: 4001 });
        }
        return window.qaWalletRequest(request);
      },
      on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      removeListener(event, callback) { listeners.get(event)?.delete(callback); },
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    window.qaAccountChanged = address => { for (const listener of listeners.get("accountsChanged") || []) listener([address]); };
  }, { cancellation });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${APP}/login`);
  const connect = page.getByRole("button", { name: "Continue with MetaMask" });
  await expect(connect).toBeEnabled();
  if (cancellation) {
    await connect.click();
    await expect(page.locator("main").getByRole("alert")).toContainText("cancelled");
    await expect(connect).toBeEnabled();
  }
  await connect.click();
  await expect(page).toHaveURL(`${APP}/dashboard`, { timeout: 45000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  return { context, page, errors, account };
}
let maker;
let uiProduct;
const workspaces = new Map();
async function workspace(actor) {
  if (!workspaces.has(actor)) workspaces.set(actor, actor === "manufacturer" ? maker : await walletPage(actor));
  return workspaces.get(actor);
}
try {
  await check("Browser cancellation recovery, real SIWE login and server session", async () => {
    maker = await walletPage("manufacturer", { cancellation: true });
    const response = await maker.context.request.get(`${APP}/api/me`);
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).data.wallet_address, maker.account.address.toLowerCase());
  });
  if (!maker) throw new Error("Manufacturer browser login is required for UI checks.");
  const { page, context } = maker;
  await check("Profile form saves and restores the real name", async () => {
    await page.goto(`${APP}/profile`);
    await page.getByLabel("Display name", { exact: true }).fill("QA Manufacturer UI Verified");
    const save = page.getByRole("button", { name: "Save changes" });
    if (await save.isEnabled()) { await save.click(); await expect(page.getByText("Your profile has been updated.")).toBeVisible(); }
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("QA Manufacturer UI Verified");
  });
  await check("Browser product registration and four passport tabs", async () => {
    try { uiProduct = JSON.parse(await readFile(`${directory}/ui-product.json`, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!uiProduct) {
      await page.goto(`${APP}/products/new`);
      await page.getByLabel("Product model", { exact: true }).fill("QA Studio Headphones — Image and UI demo");
      await page.getByLabel("Serial number", { exact: true }).fill(`QA-${run.replaceAll("-", "").toUpperCase()}-UI`);
      await page.getByRole("button", { name: "Register product", exact: true }).click();
      await expect(page).toHaveURL(/\/products\/[a-f0-9-]{36}$/);
      uiProduct = { id: new URL(page.url()).pathname.split("/").at(-1), serial: `QA-${run.replaceAll("-", "").toUpperCase()}-UI` };
      await writeFile(`${directory}/ui-product.json`, JSON.stringify(uiProduct, null, 2));
    } else await page.goto(`${APP}/products/${uiProduct.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("QA Studio Headphones");
    for (const tab of await page.getByRole("tab").all()) { await tab.click(); await expect(tab).toHaveAttribute("aria-selected", "true"); }
    await page.getByRole("tab").first().click();
  });
  await check("Large PNG auto-compression, upload, public WebP and safe replacement", async () => {
    assert.ok(uiProduct?.id);
    await page.goto(`${APP}/products/${uiProduct.id}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1500"><rect width="2400" height="1500" fill="#101e2b"/><circle cx="1200" cy="700" r="450" fill="#153d40"/><path d="M840 800V650a360 360 0 0 1 720 0v150" fill="none" stroke="#40deb4" stroke-width="85"/><rect x="755" y="690" width="180" height="350" rx="80" fill="#dce9ed"/><rect x="1465" y="690" width="180" height="350" rx="80" fill="#dce9ed"/><text x="1200" y="1260" text-anchor="middle" fill="#dce9ed" font-family="sans-serif" font-size="70">QA STUDIO HEADPHONES</text></svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: "qa-product-large.png", mimeType: "image/png", buffer });
    const upload = page.getByRole("button", { name: "Upload optimized image" });
    await expect(upload).toBeEnabled();
    const requestPromise = page.waitForResponse(response => response.url().endsWith(`/api/products/${uiProduct.id}/image`) && response.request().method() === "POST");
    await upload.click();
    const response = await requestPromise;
    assert.equal(response.status(), 200);
    const first = (await response.json()).data.image_path;
    await expect(page.getByText("Product image updated.", { exact: true })).toBeVisible();
    const img = page.getByRole("img", { name: "Product image preview" });
    const url = await img.getAttribute("src");
    assert.ok(url.includes("/storage/v1/object/public/dapp/products/"));
    const publicImage = await context.request.get(url);
    assert.equal(publicImage.status(), 200);
    const metadata = await sharp(await publicImage.body()).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 1000);
    assert.ok(Number(publicImage.headers()["content-length"]) <= 1024 * 1024);
    assert.equal(metadata.exif, undefined);
    const bad = await context.request.post(`${APP}/api/products/${uiProduct.id}/image`, { headers: { Origin: APP }, multipart: { file: { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") } } });
    assert.equal(bad.status(), 400);
    assert.equal((await (await context.request.get(`${APP}/api/products/${uiProduct.id}`)).json()).data.product.image_path, first);
    await page.locator('input[type="file"]').setInputFiles({ name: "qa-replacement.png", mimeType: "image/png", buffer });
    await expect(upload).toBeEnabled();
    const replacementPromise = page.waitForResponse(response => response.url().endsWith(`/api/products/${uiProduct.id}/image`) && response.request().method() === "POST");
    await upload.click();
    const replaced = await replacementPromise;
    assert.equal(replaced.status(), 200);
    assert.notEqual((await replaced.json()).data.image_path, first);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${directory}/screenshots/product-desktop.png`, fullPage: true });
  });
  await check("Real UI handovers manufacturer to retailer to customer", async () => {
    async function handover(from, to) {
      const source = await workspace(from);
      let detail = (await (await source.context.request.get(`${APP}/api/products/${uiProduct.id}`)).json()).data;
      if (detail.product.owner_id !== journal.actors[from].userId) return;
      if (!detail.transfers.some(item => item.status === "pending")) {
        await source.page.goto(`${APP}/products/${uiProduct.id}`);
        await source.page.getByLabel("Recipient wallet", { exact: true }).fill(journal.actors[to].address);
        await source.page.getByRole("button", { name: "Initiate transfer", exact: true }).click();
        await expect(source.page.getByText("Transfer sent. Ownership changes when the recipient accepts it.", { exact: true })).toBeVisible();
      }
      const target = await workspace(to);
      await target.page.goto(`${APP}/transfers`);
      const row = target.page.locator("tbody tr").filter({ hasText: uiProduct.serial }).filter({ has: target.page.getByRole("button", { name: "Accept", exact: true }) });
      await row.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(target.page.getByText("Transfer accepted. The product now belongs to your wallet.", { exact: true })).toBeVisible();
      detail = (await (await target.context.request.get(`${APP}/api/products/${uiProduct.id}`)).json()).data;
      assert.equal(detail.product.owner_id, journal.actors[to].userId);
    }
    await handover("manufacturer", "retailer");
    await handover("retailer", "customerA");
  });
  await check("Real customer UI claim, service-center approval and completed repair", async () => {
    const customer = await workspace("customerA");
    const center = await workspace("center");
    let detail = (await (await customer.context.request.get(`${APP}/api/products/${uiProduct.id}`)).json()).data;
    if (!detail.claims.length) {
      await customer.page.goto(`${APP}/products/${uiProduct.id}`);
      await customer.page.getByRole("tab", { name: "Warranty", exact: true }).click();
      await customer.page.getByLabel("Service center", { exact: true }).selectOption(journal.actors.center.userId);
      await customer.page.getByLabel("Describe the issue", { exact: true }).fill("QA PRIVATE UI test: headphone left channel is silent.");
      await customer.page.getByRole("button", { name: "Submit warranty request", exact: true }).click();
      await expect(customer.page.getByText("Warranty request submitted to your selected service center.", { exact: true })).toBeVisible();
    }
    await center.page.goto(`${APP}/claims`);
    const card = center.page.locator("article").filter({ hasText: uiProduct.serial });
    await expect(card).toBeVisible();
    if (await card.getByRole("button", { name: "Approve request", exact: true }).count()) {
      await card.getByRole("button", { name: "Approve request", exact: true }).click();
      await expect(card.getByRole("button", { name: "Record completed repair", exact: true })).toBeVisible();
    }
    if (await card.getByRole("button", { name: "Record completed repair", exact: true }).count()) {
      await card.getByRole("button", { name: "Record completed repair", exact: true }).click();
      await card.getByLabel("Repair performed & outcome", { exact: true }).fill("QA PRIVATE UI test: left driver replaced; stereo playback verified.");
      await card.getByRole("button", { name: "Complete & record repair", exact: true }).click();
      await expect(center.page.getByText("Repair completed and recorded. One service claim has been used.", { exact: true })).toBeVisible();
    }
    detail = (await (await customer.context.request.get(`${APP}/api/products/${uiProduct.id}`)).json()).data;
    assert.equal(detail.product.claims_used, 1);
    assert.equal(detail.services.length, 1);
    await customer.page.goto(`${APP}/products/${uiProduct.id}`);
    await customer.page.getByRole("tab", { name: "Service Records", exact: true }).click();
    await expect(customer.page.getByText("QA PRIVATE UI test: left driver replaced; stereo playback verified.", { exact: true })).toBeVisible();
  });
  for (const actor of ["manufacturer", "retailer", "customerA", "center"]) {
    await check(`Real ${actor} workspace, navigation, mobile layout and lists`, async () => {
      const current = await workspace(actor);
      const rolePage = current.page;
      for (const path of ["/dashboard", "/transfers", "/claims", "/profile"]) {
        await rolePage.goto(`${APP}${path}`);
        await expect(rolePage.locator("main h1")).toBeVisible();
        await expect(rolePage.locator('main [role="alert"]')).toHaveCount(0);
        await rolePage.setViewportSize({ width: 375, height: 812 });
        assert.equal(await rolePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Mobile horizontal overflow on ${actor} ${path}`);
        await rolePage.getByRole("button", { name: "Open navigation" }).click();
        await expect(rolePage.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
        await rolePage.getByRole("banner").getByRole("button", { name: "Close navigation" }).click();
        await rolePage.setViewportSize({ width: 1440, height: 1000 });
      }
      await rolePage.goto(`${APP}/dashboard`);
      await rolePage.screenshot({ path: `${directory}/screenshots/${actor}-dashboard.png`, fullPage: true });
      assert.deepEqual(current.errors, []);
    });
  }
  await check("Anonymous serial and copied verification link render real passport and QR", async () => {
    const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`${APP}/verify?q=${uiProduct.serial}`);
    await expect(publicPage.getByRole("heading", { name: "QA Studio Headphones — Image and UI demo", exact: true })).toBeVisible();
    await expect(publicPage.getByText("Record found", { exact: true })).toBeVisible();
    await expect(publicPage.getByRole("img", { name: "QR code for the public product passport" })).toBeVisible();
    await anonymous.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await publicPage.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(publicPage.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    assert.equal(await publicPage.evaluate(() => navigator.clipboard.readText()), `${APP}/verify?q=${uiProduct.id}`);
    const downloadPromise = publicPage.waitForEvent("download");
    await publicPage.getByRole("link", { name: "QR", exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(`${directory}/passport-qr.png`);
    assert.equal((await sharp(`${directory}/passport-qr.png`).metadata()).format, "png");
    await publicPage.getByLabel("Product ID, serial number or verification link").fill(`${APP}/verify?q=${uiProduct.id}`);
    await publicPage.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(publicPage.getByText("Record found", { exact: true })).toBeVisible();
    await publicPage.screenshot({ path: `${directory}/screenshots/verification-desktop.png`, fullPage: true });
    await publicPage.setViewportSize({ width: 375, height: 812 });
    assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await publicPage.screenshot({ path: `${directory}/screenshots/verification-mobile.png`, fullPage: true });
  });
  await check("Sepolia wallet balances, exchange and liquidity load without runtime errors", async () => {
    for (const [path, title] of [["/wallet", "Demo wallet"], ["/exchange", "Exchange"], ["/liquidity", "Pool liquidity"]]) {
      await page.goto(`${APP}${path}`);
      await expect(page.locator("main h1")).toContainText(title);
      await expect(page.getByText("Loading chain configuration…", { exact: true })).toHaveCount(0);
      // These are live read-only checks. Transactions run on actual local
      // Hardhat contracts in the isolated integration suite, not with user funds.
      await page.waitForTimeout(5000);
      await expect(page.locator('main [role="alert"]')).toHaveCount(0);
      await page.screenshot({ path: `${directory}/screenshots/${path.slice(1)}.png`, fullPage: true });
    }
  });
  await check("Account-change logout clears authenticated workspace", async () => {
    await page.goto(`${APP}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
    await page.evaluate(address => window.qaAccountChanged(address), journal.actors.customerB.address);
    await expect(page).toHaveURL(`${APP}/login`, { timeout: 30000 });
    assert.equal((await context.request.get(`${APP}/api/me`)).status(), 401);
  });
} finally {
  await report();
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
if (failures.length) process.exitCode = 1;
console.log(`Live browser acceptance: ${results.filter(item => item.status === "passed").length}/${results.length} passed. Report: ${directory}/browser-report.json`);
