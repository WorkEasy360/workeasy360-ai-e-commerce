// Performance budgets: the JavaScript a browser must download, gzipped, to
// show each page. Run against production servers (`pnpm build`, then
// `pnpm --filter @workeasy/admin start` and the storefront's `start`), never
// `pnpm dev`, whose bundles are unminified:
//
//   node scripts/perf-budget.mjs [--store <slug>]
//
// The storefront is what shoppers load on phones, often on slow networks,
// so its budget is tight; the admin is a desktop tool and gets more room.
// Exits 1 when any page is over its budget.
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ADMIN = process.env.BUDGET_ADMIN_URL ?? "http://localhost:3000";
const STOREFRONT = process.env.BUDGET_STOREFRONT_URL ?? "http://localhost:3001";
const storeIndex = process.argv.indexOf("--store");
const SLUG = storeIndex > 0 ? process.argv[storeIndex + 1] : process.env.BUDGET_STORE_SLUG;

const KB = 1024;
export const BUDGETS = { storefront: 200 * KB, admin: 250 * KB };
// Any id renders the admin's client shell; the data loads afterwards.
const STORE_ID = "00000000-0000-4000-8000-000000000000";

/** The same-origin script URLs a page's HTML asks the browser to load. */
export function scriptUrls(html, pageUrl) {
  const urls = new Set();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const url = new URL(match[1].replaceAll("&amp;", "&"), pageUrl);
    if (url.origin === new URL(pageUrl).origin) urls.add(url.toString());
  }
  return [...urls];
}

const gzipped = new Map();
async function gzippedSize(url) {
  if (!gzipped.has(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    gzipped.set(url, gzipSync(Buffer.from(await res.arrayBuffer()), { level: 9 }).length);
  }
  return gzipped.get(url);
}

async function measure(url) {
  const res = await fetch(url, { redirect: "manual" });
  if (res.status >= 400) throw new Error(`${url}: ${res.status}`);
  const scripts = scriptUrls(await res.text(), url);
  let total = 0;
  for (const s of scripts) total += await gzippedSize(s);
  return { total, scripts: scripts.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pages = [
    ["admin", "sign in", `${ADMIN}/`],
    ["admin", "dashboard", `${ADMIN}/s/${STORE_ID}`],
    ["admin", "products", `${ADMIN}/s/${STORE_ID}/products`],
    ["admin", "product editor", `${ADMIN}/s/${STORE_ID}/products/new`],
    ["admin", "orders", `${ADMIN}/s/${STORE_ID}/orders`],
    ["admin", "analytics", `${ADMIN}/s/${STORE_ID}/analytics`],
    ["admin", "store design", `${ADMIN}/s/${STORE_ID}/design`],
    ["admin", "ai studio", `${ADMIN}/s/${STORE_ID}/ai`],
  ];
  if (SLUG) {
    const shop = `${STOREFRONT}/s/${SLUG}`;
    pages.push(["storefront", "home", shop], ["storefront", "all products", `${shop}/products`], ["storefront", "cart", `${shop}/cart`], ["storefront", "checkout", `${shop}/checkout`]);
    const listed = await fetch(`${STOREFRONT}/public/v1/stores/${SLUG}/products?limit=1`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const handle = listed.products?.[0]?.handle;
    if (handle) pages.push(["storefront", "product", `${shop}/p/${handle}`]);
  } else {
    console.log("No --store given, so storefront pages are skipped.");
  }

  let over = 0;
  for (const [app, name, url] of pages) {
    try {
      const { total, scripts } = await measure(url);
      const budget = BUDGETS[app];
      const ok = total <= budget;
      if (!ok) over++;
      console.log(`${ok ? "ok  " : "OVER"} ${app} ${name}: ${(total / KB).toFixed(1)} KB gzipped in ${scripts} scripts (budget ${budget / KB} KB)`);
    } catch (err) {
      over++;
      console.log(`FAIL ${app} ${name}: ${err.message}`);
    }
  }
  console.log(over === 0 ? "All pages are within budget." : `${over} page(s) over budget or unreachable.`);
  process.exit(over === 0 ? 0 : 1);
}
