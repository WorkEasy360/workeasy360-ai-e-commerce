/**
 * Money is stored and computed as integer minor units (paise, cents) with
 * its ISO 4217 currency; floats appear only at the edges, when a person
 * types or reads an amount.
 */

/** Digits after the decimal point for a currency: 2 for INR and USD, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Largest amount we accept anywhere: 10 billion major units, well inside Number.MAX_SAFE_INTEGER. */
export const MAX_MINOR = 10_000_000_000 * 1000;

/**
 * Parses an amount someone typed ("1,299.50", "₹ 999", "12") into minor units.
 * Undefined for anything that is not a non-negative amount with at most the
 * currency's decimal places.
 */
export function parseMoney(input: string, currency: string): number | undefined {
  const digits = minorDigits(currency);
  // Strip a leading currency symbol or code, but never a minus sign: negative amounts are refused below.
  const cleaned = input.replace(/[\s,_]/g, "").replace(/^[^\d.-]+/, "");
  if (cleaned === "") return undefined;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return undefined;
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return undefined;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) && minor <= MAX_MINOR ? minor : undefined;
}

/** Minor units as a plain decimal string for inputs and CSV ("1299.50"); no symbol or grouping. */
export function toDecimalString(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** digits);
  const fraction = String(abs % 10 ** digits).padStart(digits, "0");
  return `${sign}${whole}.${fraction}`;
}

/** Minor units for people to read: "₹1,299.50". Whole amounts drop the decimals when `compact`. */
export function formatMoney(minor: number, currency: string, locale = "en-IN", options: { compact?: boolean } = {}): string {
  const digits = minorDigits(currency);
  const value = minor / 10 ** digits;
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: options.compact && whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currency} ${toDecimalString(minor, currency)}`;
  }
}

/** "₹499 – ₹1,299", or a single price when they are equal. */
export function formatPriceRange(min: number, max: number, currency: string, locale?: string): string {
  const a = formatMoney(min, currency, locale, { compact: true });
  return min === max ? a : `${a} – ${formatMoney(max, currency, locale, { compact: true })}`;
}
