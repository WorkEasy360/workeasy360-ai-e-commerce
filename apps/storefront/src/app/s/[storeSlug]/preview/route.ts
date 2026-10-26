import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE } from "../../../../lib/shop-context";

/**
 * Opened by Store Design: remembers the signed preview token in a cookie
 * and shows the shop with the draft theme. `?exit=1` goes back to the live
 * theme. The API checks the token on every request; this only carries it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  const url = request.nextUrl;
  const target = new URL(`/s/${storeSlug}`, url);
  const res = NextResponse.redirect(target, 303);
  const token = url.searchParams.get("token");
  const secure = url.protocol === "https:";
  if (url.searchParams.get("exit") === "1" || !token || !/^\d+\.[A-Za-z0-9_-]{20,}$/.test(token)) {
    res.cookies.delete(PREVIEW_COOKIE);
    return res;
  }
  // The admin shows the preview in a frame on another origin; over https that needs SameSite=None.
  res.cookies.set(PREVIEW_COOKIE, `${storeSlug}:${token}`, { httpOnly: true, path: "/", maxAge: 2 * 60 * 60, sameSite: secure ? "none" : "lax", secure });
  return res;
}
