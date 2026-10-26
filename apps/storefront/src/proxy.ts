import { NextResponse, type NextRequest } from "next/server";

/**
 * Custom domains. A request for shop.example.com is served as the shop it
 * belongs to: "/" shows /s/<slug>, "/p/tea" shows /s/<slug>/p/tea. The
 * platform's own host (and localhost) pass through untouched. Lookups are
 * cached briefly in memory; the API answers only for verified domains.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const PLATFORM_HOSTS = new Set(["localhost", "127.0.0.1", new URL(process.env.STOREFRONT_PUBLIC_URL ?? "http://localhost:3001").hostname]);
const TTL_MS = 60_000;
const cache = new Map<string, { slug: string | null; at: number }>();

async function slugFor(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/public/v1/domains/${encodeURIComponent(host)}`, { headers: { accept: "application/json" } });
    if (res.ok) slug = ((await res.json()) as { slug: string }).slug;
  } catch {
    // The API is unreachable: show nothing rather than the wrong shop, and retry on the next request.
    return null;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(host, { slug, at: Date.now() });
  return slug;
}

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  if (!host || PLATFORM_HOSTS.has(host)) return NextResponse.next();
  const { pathname } = request.nextUrl;
  // Already a shop path (links inside pages), or shared assets and the API.
  if (pathname.startsWith("/s/") || pathname.startsWith("/public/") || pathname.startsWith("/_next/")) return NextResponse.next();
  const slug = await slugFor(host);
  if (!slug) return new NextResponse("This domain isn't connected to a shop yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const url = request.nextUrl.clone();
  url.pathname = `/s/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything except static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
