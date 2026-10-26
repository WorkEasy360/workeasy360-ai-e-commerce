/**
 * Turning a visit's referrer and campaign tag into a traffic source, and its
 * user agent into a device class. Only these labels are stored; the referrer
 * URL and user agent themselves are not.
 */

const KNOWN: Array<[RegExp, string]> = [
  [/(^|\.)google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.me|l\.facebook\.com|m\.facebook\.com)$/, "Facebook"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "WhatsApp"],
  [/(^|\.)(t\.me|telegram\.org)$/, "Telegram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "X"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)pinterest\./, "Pinterest"],
];

export function trafficSource(referrer: string | null | undefined, utmSource: string | null | undefined, ownHosts: readonly string[]): string {
  const tag = utmSource?.trim().toLowerCase();
  if (tag) {
    for (const [, name] of KNOWN) if (name.toLowerCase() === tag) return name;
    return tag.replace(/[^a-z0-9 ._-]/g, "").slice(0, 40) || "direct";
  }
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "direct";
  }
  if (!host || ownHosts.includes(host)) return "direct";
  return KNOWN.find(([re]) => re.test(host))?.[1] ?? host.slice(0, 60);
}

export function deviceClass(userAgent: string | undefined): "mobile" | "tablet" | "desktop" {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "mobile";
  return "desktop";
}

/** Crawlers and link previews aren't visitors. */
export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|curl|wget/i.test(userAgent);
}
