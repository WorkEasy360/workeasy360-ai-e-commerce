/**
 * Choices offered when creating or editing a store. The API accepts any
 * valid ISO code; these are the common ones, listed first for India.
 */
export const COUNTRIES: ReadonlyArray<{ code: string; name: string; currency: string; timezone: string }> = [
  { code: "IN", name: "India", currency: "INR", timezone: "Asia/Kolkata" },
  { code: "AE", name: "United Arab Emirates", currency: "AED", timezone: "Asia/Dubai" },
  { code: "AU", name: "Australia", currency: "AUD", timezone: "Australia/Sydney" },
  { code: "BD", name: "Bangladesh", currency: "BDT", timezone: "Asia/Dhaka" },
  { code: "CA", name: "Canada", currency: "CAD", timezone: "America/Toronto" },
  { code: "DE", name: "Germany", currency: "EUR", timezone: "Europe/Berlin" },
  { code: "FR", name: "France", currency: "EUR", timezone: "Europe/Paris" },
  { code: "GB", name: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  { code: "LK", name: "Sri Lanka", currency: "LKR", timezone: "Asia/Colombo" },
  { code: "MY", name: "Malaysia", currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
  { code: "NP", name: "Nepal", currency: "NPR", timezone: "Asia/Kathmandu" },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", timezone: "Asia/Riyadh" },
  { code: "SG", name: "Singapore", currency: "SGD", timezone: "Asia/Singapore" },
  { code: "US", name: "United States", currency: "USD", timezone: "America/New_York" },
];

export const CURRENCIES: readonly string[] = ["INR", "USD", "EUR", "GBP", "AED", "AUD", "BDT", "CAD", "LKR", "MYR", "NPR", "SAR", "SGD"];

export const LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी (Hindi)" },
  { code: "bn", name: "বাংলা (Bengali)" },
  { code: "ta", name: "தமிழ் (Tamil)" },
  { code: "te", name: "తెలుగు (Telugu)" },
  { code: "mr", name: "मराठी (Marathi)" },
  { code: "gu", name: "ગુજરાતી (Gujarati)" },
  { code: "ar", name: "العربية (Arabic)" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
];

/** A store address from its name: lowercase words joined by hyphens, 3–48 characters. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : slug ? `${slug}-shop` : "";
}
