// Accessibility and mobile audit against a running local stack
// (`pnpm infra:up`, `pnpm db:seed`, `pnpm dev`). Signs in to the admin,
// then on every admin module and every storefront page, at desktop and
// phone widths and in dark mode:
//   - runs axe-core (WCAG 2.0/2.1/2.2 A and AA rules, plus best practices
//     reported as advisory)
//   - checks that the page does not scroll sideways
// and walks a keyboard-only journey on the storefront: open a product and
// add it to the cart without a mouse.
//
// Usage: node scripts/a11y-audit.mjs [--out <dir>]
// Signs in as A11Y_EMAIL / A11Y_PASSWORD and audits their first store (or
// A11Y_STORE_ID). Without them, signs up a throwaway account with a new store.
// Exits 1 when a serious or critical issue is found.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const ADMIN = process.env.A11Y_ADMIN_URL ?? "http://localhost:3000";
const STOREFRONT = process.env.A11Y_STOREFRONT_URL ?? "http://localhost:3001";
const local = (url) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
if (!process.env.A11Y_EMAIL && !local(ADMIN)) throw new Error("Set A11Y_EMAIL and A11Y_PASSWORD for a non-local admin.");
const EMAIL = process.env.A11Y_EMAIL;
const PASSWORD = process.env.A11Y_PASSWORD ?? `a11y-${Date.now()}-password`;
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
if (OUT) mkdirSync(OUT, { recursive: true });

const VIEWPORTS = { desktop: { width: 1366, height: 900 }, phone: { width: 390, height: 844 }, "desktop-dark": { width: 1366, height: 900 } };
const BLOCKING = new Set(["serious", "critical"]);
const findings = [];
const checks = [];

function record(page, viewport, kind, detail) {
  findings.push({ page, viewport, kind, ...detail });
}

async function audit(page, name, viewport) {
  await page.addScriptTag({ path: AXE_PATH });
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return r.violations.map((v) => ({
      id: v.id,
      // Best-practice rules are reported but never block.
      impact: v.tags.some((t) => t.startsWith("wcag")) ? v.impact : "advisory",
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
  });
  for (const v of result) record(name, viewport, "axe", v);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) record(name, viewport, "overflow", { id: "horizontal-scroll", impact: "serious", help: `Page scrolls sideways by ${overflow}px` });
  checks.push(`${name} @ ${viewport}`);
  if (OUT) await page.screenshot({ path: `${OUT}/${name.replace(/[^a-z0-9]+/gi, "-")}-${viewport}.png`, fullPage: true });
}

async function settle(page, selector) {
  if (selector) await page.waitForSelector(selector, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();
let exitCode = 0;
try {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const headers = { Origin: ADMIN, "content-type": "application/json" };

  // The sign-in page is audited signed out, then the API signs the context in.
  await page.goto(`${ADMIN}/`);
  await settle(page, "form");
  await audit(page, "sign in", "desktop");
  const signIn = EMAIL
    ? await page.request.post(`${ADMIN}/auth/password/login`, { headers, data: { email: EMAIL, password: PASSWORD } })
    : await page.request.post(`${ADMIN}/auth/password/signup`, { headers, data: { email: `a11y-${Date.now()}@example.test`, password: PASSWORD, name: "Audit" } });
  if (!signIn.ok()) throw new Error(`Sign-in failed: ${signIn.status()}`);
  if (!EMAIL) {
    const made = await page.request.post(`${ADMIN}/api/v1/stores`, { headers, data: { name: "Audit Store", slug: `audit-${Date.now().toString(36)}` } });
    if (!made.ok()) throw new Error(`Creating a store failed: ${made.status()}`);
  }

  const { stores } = await (await page.request.get(`${ADMIN}/api/v1/me`)).json();
  const store = stores.find((s) => s.id === process.env.A11Y_STORE_ID) ?? stores[0];
  if (!store) throw new Error("The account has no store; run `pnpm db:seed`.");
  const base = `${ADMIN}/s/${store.id}`;
  const api = `${ADMIN}/api/v1/stores/${store.id}`;
  const first = async (path) => (await (await page.request.get(`${api}/${path}`)).json()).items?.[0];
  const product = await first("products");
  const collection = await first("collections");
  const order = await first("orders");
  const customer = await first("customers");
  const pages = (await (await page.request.get(`${api}/pages`)).json()).items ?? [];
  const contentPage = pages[0];
  const publishedPage = pages.find((p) => p.published);

  const adminPages = [
    ["stores", `${ADMIN}/`, "main"],
    ["dashboard", base, "main h1"],
    ["products", `${base}/products`, "table, .c-empty"],
    ["new product", `${base}/products/new`, "main h1"],
    ...(product ? [["product", `${base}/products/${product.id}`, "main h1"]] : []),
    ["collections", `${base}/collections`, "main h1"],
    ...(collection ? [["collection", `${base}/collections/${collection.id}`, "main h1"]] : []),
    ["orders", `${base}/orders`, "main h1"],
    ...(order ? [["order", `${base}/orders/${order.id}`, "main h1"]] : []),
    ["customers", `${base}/orders/customers`, "main h1"],
    ...(customer ? [["customer", `${base}/orders/customers/${customer.id}`, "main h1"]] : []),
    ["abandoned checkouts", `${base}/orders/abandoned`, "main h1"],
    ["bookings", `${base}/orders/bookings`, "main h1"],
    ["offers", `${base}/offers`, "main h1"],
    ["shipping", `${base}/shipping`, "main h1"],
    ["payments", `${base}/payments`, "main h1"],
    ["reviews", `${base}/reviews`, "main h1"],
    ["inventory", `${base}/inventory`, "main h1"],
    ["media", `${base}/media`, "main h1"],
    ["analytics", `${base}/analytics`, "main h1"],
    ["design", `${base}/design`, "main h1"],
    ["pages", `${base}/design/pages`, "main h1"],
    ...(contentPage ? [["page editor", `${base}/design/pages/${contentPage.id}`, "main textarea"]] : []),
    ["ai studio", `${base}/ai`, "main h1"],
    ["settings", `${base}/settings`, "main h1"],
    ["checkout settings", `${base}/settings/checkout`, "main h1"],
    ["staff", `${base}/settings/staff`, "main h1"],
    ["domain", `${base}/settings/domain`, "main h1"],
    ["audit log", `${base}/settings/audit`, "main h1"],
    ["invitation", `${ADMIN}/invite/${"x".repeat(32)}`, ".c-card"],
  ];
  const shop = `${STOREFRONT}/s/${store.slug}`;
  const storefrontPages = [
    ["shop home", shop, "main"],
    ["all products", `${shop}/products`, "main"],
    ...(collection ? [["shop collection", `${shop}/c/${collection.handle}`, "main"]] : []),
    ...(product ? [["shop product", `${shop}/p/${product.handle}`, "main"]] : []),
    ...(publishedPage ? [["shop content page", `${shop}/pages/${publishedPage.handle}`, "main h1"]] : []),
    ["cart", `${shop}/cart`, "main"],
    ["checkout", `${shop}/checkout`, "main"],
  ];

  // Keyboard journey: open a physical product from the shop's list and add it to the cart.
  const visitor = await (await browser.newContext({ viewport: VIEWPORTS.desktop })).newPage();
  const physical = (await (await page.request.get(`${api}/products?type=physical&status=active`)).json()).items?.[0];
  if (physical) {
    await visitor.goto(`${shop}/p/${physical.handle}`);
    await settle(visitor, "main");
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await visitor.keyboard.press("Tab");
      reached = await visitor.evaluate(() => /add to (cart|bag)/i.test(document.activeElement?.textContent ?? ""));
    }
    if (reached) {
      await visitor.keyboard.press("Enter");
      await visitor.waitForTimeout(800);
      await visitor.goto(`${shop}/cart`);
      await settle(visitor, "main");
      const inCart = await visitor.locator(`text=${physical.title}`).count();
      if (!inCart) record("shop product", "desktop", "keyboard", { id: "keyboard-add-to-cart", impact: "critical", help: "Enter on Add to cart did not add the product" });
    } else {
      record("shop product", "desktop", "keyboard", { id: "keyboard-reach-add-to-cart", impact: "critical", help: "Add to cart could not be reached with Tab" });
    }
  }

  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    const scheme = viewport.endsWith("-dark") ? "dark" : "light";
    for (const p of [page, visitor]) {
      await p.setViewportSize(size);
      await p.emulateMedia({ colorScheme: scheme });
    }
    for (const [name, url, selector] of adminPages) {
      await page.goto(url);
      await settle(page, selector);
      await audit(page, name, viewport);
    }
    for (const [name, url, selector] of storefrontPages) {
      await visitor.goto(url);
      await settle(visitor, selector);
      await audit(visitor, name, viewport);
    }
  }
} catch (err) {
  console.error("Audit could not finish:", err.message.split("\n")[0]);
  exitCode = 2;
} finally {
  await browser.close();
}

const blocking = findings.filter((f) => BLOCKING.has(f.impact));
const report = { checkedAt: new Date().toISOString(), checks, findings };
if (OUT) writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`Checked ${checks.length} page views and the keyboard journey.`);
for (const f of findings) console.log(`[${f.impact}] ${f.page} @ ${f.viewport}: ${f.id} - ${f.help}${f.targets ? `\n    ${f.targets.join("\n    ")}` : ""}`);
if (exitCode) console.log("The audit did not finish, so these results are incomplete.");
else console.log(blocking.length === 0 ? "No serious or critical issues." : `${blocking.length} serious or critical issue(s).`);
process.exit(exitCode || (blocking.length > 0 ? 1 : 0));
