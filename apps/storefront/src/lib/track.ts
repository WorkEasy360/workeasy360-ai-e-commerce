"use client";

/**
 * Anonymous visit tracking for the shop's own analytics. A random session id
 * lives in this browser for 30 minutes of inactivity; nothing identifies the
 * shopper, and nothing is sent when the browser asks not to be tracked.
 * Events go in small batches with sendBeacon, so they never slow a page.
 */
export type TrackEvent = { type: "page_view" | "product_view" | "add_to_cart" | "checkout_start"; path?: string | null; productId?: string | null };

const SESSION_KEY = "we-visit";
const IDLE_MS = 30 * 60 * 1000;

let queue: Array<TrackEvent & { slug: string }> = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function optedOut(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.doNotTrack === "1" || n.globalPrivacyControl === true;
}

/** This visit's id, and where it came from (only on its first page). */
function session(): { id: string; first: boolean } {
  const now = Date.now();
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as { id: string; at: number } | null;
    if (saved && now - saved.at < IDLE_MS) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: saved.id, at: now }));
      return { id: saved.id, first: false };
    }
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: now }));
    return { id, first: true };
  } catch {
    // Storage blocked: one id per page load is the best we can do.
    return { id: crypto.randomUUID().replace(/-/g, "").slice(0, 24), first: true };
  }
}

function flush() {
  timer = undefined;
  const bySlug = new Map<string, TrackEvent[]>();
  for (const { slug, ...e } of queue) bySlug.set(slug, [...(bySlug.get(slug) ?? []), e]);
  queue = [];
  const s = session();
  const params = new URLSearchParams(location.search);
  for (const [slug, events] of bySlug) {
    const body = JSON.stringify({
      sessionId: s.id,
      ...(s.first ? { referrer: document.referrer || null, utmSource: params.get("utm_source") } : {}),
      events: events.slice(0, 20),
    });
    const url = `/public/v1/stores/${slug}/events`;
    const sent = navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }));
    if (!sent) void fetch(url, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
  }
}

export function track(slug: string, event: TrackEvent): void {
  if (typeof window === "undefined" || optedOut()) return;
  queue.push({ slug, path: location.pathname, ...event });
  if (!timer) timer = setTimeout(flush, 800);
}
