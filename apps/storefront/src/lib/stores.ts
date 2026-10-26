// Server-side lookups for storefront pages: they call the API directly, never from the browser.
import type { Theme } from "@workeasy/commerce";
import type { ReviewableItem } from "../components/reviews";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const HANDLE_PATTERN = /^[a-z0-9-]{1,100}$/;

export type PaymentMethod = "card" | "cod" | "bank" | "upi" | "whatsapp" | "telegram";
export type DeliveryMethod = "delivery" | "pickup" | "none";

/** A store as shoppers see it, from GET /public/v1/stores/:slug. */
export interface PublicStore {
  slug: string;
  name: string;
  currency: string;
  country: string;
  defaultLocale: string;
}

export interface CheckoutOptions {
  paymentMethods: PaymentMethod[];
  /** The connected card gateway, when "card" is offered. */
  card: { provider: "razorpay" | "stripe" } | null;
  delivery: { enabled: boolean; feeMinor: number; freeOverMinor: number | null };
  pickup: { address: string | null } | null;
  orderNoteEnabled: boolean;
}

export interface NavCollection {
  handle: string;
  title: string;
  description: string;
  imageId: string | null;
}

export interface Shop {
  store: PublicStore;
  checkout: CheckoutOptions;
  collections: NavCollection[];
  theme: Theme;
  /** True when this is the merchant's draft, shown through a preview link. */
  preview: boolean;
}

export interface ProductCard {
  id: string;
  handle: string;
  title: string;
  type: "physical" | "digital" | "service";
  imageId: string | null;
  imageAlt: string;
  priceMin: number;
  priceMax: number;
  compareAtMinor: number | null;
  available: boolean;
}

export interface ShopProduct {
  id: string;
  handle: string;
  title: string;
  type: "physical" | "digital" | "service";
  description: string;
  vendor: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  media: Array<{ id: string; kind: "image" | "video"; alt: string; width: number | null; height: number | null }>;
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{ id: string; options: string[]; priceMinor: number; compareAtMinor: number | null; available: boolean; maxQuantity: number | null }>;
  bookingDurationMinutes: number | null;
  bookingNoticeHours: number | null;
  downloadLimit: number | null;
  downloadExpiryDays: number | null;
}

export interface ShopperOrder {
  number: number;
  status: "open" | "cancelled";
  paymentStatus: "pending" | "paid" | "partially_refunded" | "refunded";
  fulfillmentStatus: "unfulfilled" | "partially_fulfilled" | "fulfilled";
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  name: string;
  email: string;
  address: { line1: string; line2: string | null; city: string; state: string | null; postalCode: string; country: string } | null;
  pickupAddress: string | null;
  note: string | null;
  currency: string;
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  discountMinor: number;
  /** The code, or the automatic offer's name. */
  discountLabel: string | null;
  taxMinor: number;
  taxLabel: string | null;
  pricesIncludeTax: boolean;
  shippingRateName: string | null;
  refundedMinor: number;
  downloads: Array<{ id: string; fileName: string; downloadsLeft: number | null; expiresAt: string | null; usable: boolean; url: string }>;
  placedAt: string;
  /** Card orders awaiting payment: when the hold on the items ends. */
  payBy: string | null;
  shipments: Array<{ carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; units: number; at: string }>;
  items: Array<{ title: string; variantTitle: string | null; productType: string; imageId: string | null; quantity: number; unitPriceMinor: number; totalMinor: number; bookingLabel: string | null }>;
  paymentInstructions: string | null;
  chat: { channel: "whatsapp" | "telegram"; url: string; message: string } | null;
}

/**
 * GET from the public API. Undefined on 404; other failures throw so the
 * error page shows instead of a false "not found".
 */
async function get<T>(path: string, revalidate = 15): Promise<T | undefined> {
  const res = await fetch(`${API_INTERNAL_URL}/public/v1${path}`, { headers: { accept: "application/json" }, next: { revalidate } });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Storefront request failed with status ${res.status}`);
  return (await res.json()) as T;
}

export async function getShop(slug: string, previewToken?: string): Promise<Shop | undefined> {
  if (!SLUG_PATTERN.test(slug)) return undefined;
  if (previewToken) {
    // Drafts are never cached.
    const res = await fetch(`${API_INTERNAL_URL}/public/v1/stores/${slug}?preview=${encodeURIComponent(previewToken)}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Storefront request failed with status ${res.status}`);
    return (await res.json()) as Shop;
  }
  return get<Shop>(`/stores/${slug}`, 30);
}

export type ShopSort = "newest" | "price_asc" | "price_desc" | "title";

export async function getProducts(slug: string, opts: { q?: string | undefined; sort?: ShopSort | undefined; page?: number | undefined } = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  return get<{ products: ProductCard[]; total: number; page: number; pageSize: number }>(`/stores/${slug}/products?${params.toString()}`);
}

export async function getProduct(slug: string, handle: string) {
  if (!HANDLE_PATTERN.test(handle)) return undefined;
  return (await get<{ product: ShopProduct }>(`/stores/${slug}/products/${handle}`))?.product;
}

export async function getCollection(slug: string, handle: string, sort?: ShopSort) {
  if (!HANDLE_PATTERN.test(handle)) return undefined;
  return get<{ collection: NavCollection & { seoTitle: string | null; seoDescription: string | null }; products: ProductCard[] }>(
    `/stores/${slug}/collections/${handle}${sort ? `?sort=${sort}` : ""}`,
  );
}

export interface ShopPage {
  handle: string;
  title: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

export async function getPage(slug: string, handle: string) {
  if (!HANDLE_PATTERN.test(handle)) return undefined;
  return (await get<{ page: ShopPage }>(`/stores/${slug}/pages/${handle}`))?.page;
}

/** `paidWith: "stripe"` on return from Stripe, so the shop checks the payment straight away. */
export async function getOrder(slug: string, token: string, paidWith?: "stripe") {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return undefined;
  const res = await fetch(`${API_INTERNAL_URL}/public/v1/stores/${slug}/orders/${token}${paidWith ? `?paid=${paidWith}` : ""}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Order request failed with status ${res.status}`);
  return (await res.json()) as { order: ShopperOrder; contactEmail: string | null; reviews: ReviewableItem[] | null };
}

export interface ProductReviews {
  summary: { average: number | null; count: number; histogram: [number, number, number, number, number] };
  reviews: Array<{ id: string; author: string; rating: number; title: string | null; body: string; reply: string | null; createdAt: string }>;
}

export async function getReviews(slug: string, handle: string): Promise<ProductReviews | undefined> {
  if (!HANDLE_PATTERN.test(handle)) return undefined;
  return get<ProductReviews>(`/stores/${slug}/products/${handle}/reviews`, 30);
}

/** The emailed review link: undefined when it's unknown or has expired. */
export async function getReviewRequest(slug: string, token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return undefined;
  const res = await fetch(`${API_INTERNAL_URL}/public/v1/stores/${slug}/review-requests/${token}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Review link request failed with status ${res.status}`);
  return (await res.json()) as { number: number; name: string; items: ReviewableItem[] };
}

export function mediaUrl(id: string): string {
  return `/public/v1/media/${id}`;
}

export const SORTS: Array<{ value: ShopSort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "title", label: "Name: A–Z" },
];

export function parseSort(value: unknown): ShopSort | undefined {
  return SORTS.find((s) => s.value === value)?.value;
}
