import { sql, type Transaction } from "kysely";
import type { CollectionRules } from "@workeasy/commerce";
import type { CollectionSort, Database, ProductType } from "../schema.js";
import { productIdsIn } from "./collections.js";

/**
 * What shoppers see. These run as the public role inside the shop's store
 * context, where row security already limits every table to what is on sale
 * (migration 0005); nothing here filters by status itself.
 */
type Trx = Transaction<Database>;

export interface ProductCard {
  id: string;
  handle: string;
  title: string;
  type: ProductType;
  imageId: string | null;
  imageAlt: string;
  priceMin: number;
  priceMax: number;
  /** The cheapest variant's compare-at price, when it shows a saving. */
  compareAtMinor: number | null;
  /** Whether any variant can be bought now. */
  available: boolean;
}

/** A variant can be bought when it isn't tracked, may be backordered, or has stock left. */
const purchasable = sql<boolean>`(NOT v.track_inventory OR v.allow_backorder OR coalesce((SELECT l.on_hand - l.reserved FROM app.inventory_levels l WHERE l.variant_id = v.id), 0) > 0)`;

export async function productCards(trx: Trx, ids: readonly string[]): Promise<ProductCard[]> {
  if (ids.length === 0) return [];
  const rows = await trx
    .selectFrom("products as p")
    .select([
      "p.id",
      "p.handle",
      "p.title",
      "p.type",
      sql<string | null>`(SELECT pm.media_id FROM app.product_media pm JOIN app.media_assets m ON m.id = pm.media_id WHERE pm.product_id = p.id AND m.kind = 'image' ORDER BY pm.position LIMIT 1)`.as("image_id"),
      sql<string>`(SELECT min(v.price_minor) FROM app.variants v WHERE v.product_id = p.id)`.as("price_min"),
      sql<string>`(SELECT max(v.price_minor) FROM app.variants v WHERE v.product_id = p.id)`.as("price_max"),
      sql<string | null>`(SELECT v.compare_at_minor FROM app.variants v WHERE v.product_id = p.id ORDER BY v.price_minor, v.position LIMIT 1)`.as("compare_at"),
      sql<boolean>`EXISTS (SELECT 1 FROM app.variants v WHERE v.product_id = p.id AND ${purchasable})`.as("available"),
    ])
    .where("p.id", "in", ids)
    .execute();
  const alts = await imageAlts(trx, rows.map((r) => r.image_id).filter((x): x is string => x !== null));
  const byId = new Map(
    rows.map((r) => {
      const priceMin = Number(r.price_min ?? 0);
      const compare = r.compare_at === null ? null : Number(r.compare_at);
      return [
        r.id,
        {
          id: r.id,
          handle: r.handle,
          title: r.title,
          type: r.type,
          imageId: r.image_id,
          imageAlt: (r.image_id && alts.get(r.image_id)) || r.title,
          priceMin,
          priceMax: Number(r.price_max ?? 0),
          compareAtMinor: compare !== null && compare > priceMin ? compare : null,
          available: r.available,
        } satisfies ProductCard,
      ];
    }),
  );
  return ids.map((id) => byId.get(id)).filter((p): p is ProductCard => p !== undefined);
}

async function imageAlts(trx: Trx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await trx.selectFrom("media_assets").select(["id", "alt_text"]).where("id", "in", ids).execute();
  return new Map(rows.map((r) => [r.id, r.alt_text]));
}

export type ShopSort = "newest" | "price_asc" | "price_desc" | "title";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Products on sale, for "Shop all" and search. Returns one page of ids and the total. */
export async function searchProductIds(trx: Trx, query: { q?: string | undefined; sort: ShopSort; limit: number; offset: number }): Promise<{ ids: string[]; total: number }> {
  let q = trx.selectFrom("products as p");
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    const term = query.q.toLowerCase();
    q = q.where((eb) => eb.or([eb("p.title", "ilike", pattern), eb("p.vendor", "ilike", pattern), eb("p.description", "ilike", pattern), sql<boolean>`${term} = ANY (p.tags)`]));
  }
  const total = await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow();
  const minPrice = sql`(SELECT min(v.price_minor) FROM app.variants v WHERE v.product_id = p.id)`;
  const order =
    query.sort === "price_asc" ? sql`${minPrice} ASC, p.id` : query.sort === "price_desc" ? sql`${minPrice} DESC, p.id` : query.sort === "title" ? sql`p.title, p.id` : sql`coalesce(p.published_at, p.created_at) DESC, p.id DESC`;
  const rows = await q.select("p.id").orderBy(order).limit(query.limit).offset(query.offset).execute();
  return { ids: rows.map((r) => r.id), total: total.n };
}

export interface ShopVariant {
  id: string;
  options: string[];
  priceMinor: number;
  compareAtMinor: number | null;
  available: boolean;
  /** Units a shopper may add; null when not limited by stock. */
  maxQuantity: number | null;
}

export interface ShopProduct {
  id: string;
  handle: string;
  title: string;
  type: ProductType;
  description: string;
  vendor: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  media: Array<{ id: string; kind: "image" | "video"; alt: string; width: number | null; height: number | null }>;
  options: Array<{ name: string; values: string[] }>;
  variants: ShopVariant[];
  bookingDurationMinutes: number | null;
  bookingNoticeHours: number | null;
  downloadLimit: number | null;
  downloadExpiryDays: number | null;
}

export async function productByHandle(trx: Trx, handle: string): Promise<ShopProduct | undefined> {
  const p = await trx.selectFrom("products").selectAll().where("handle", "=", handle).executeTakeFirst();
  if (!p) return undefined;
  const [options, variants, media] = await Promise.all([
    trx.selectFrom("product_options").select(["name", "values"]).where("product_id", "=", p.id).orderBy("position").execute(),
    trx
      .selectFrom("variants as v")
      .leftJoin("inventory_levels as l", "l.variant_id", "v.id")
      .select(["v.id", "v.options", "v.price_minor", "v.compare_at_minor", "v.track_inventory", "v.allow_backorder", "l.on_hand", "l.reserved"])
      .where("v.product_id", "=", p.id)
      .orderBy("v.position")
      .execute(),
    trx
      .selectFrom("product_media as pm")
      .innerJoin("media_assets as m", "m.id", "pm.media_id")
      .select(["m.id", "m.kind", "m.alt_text", "m.width", "m.height"])
      .where("pm.product_id", "=", p.id)
      .orderBy("pm.position")
      .execute(),
  ]);
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    type: p.type,
    description: p.description,
    vendor: p.vendor,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    media: media.filter((m) => m.kind !== "file").map((m) => ({ id: m.id, kind: m.kind as "image" | "video", alt: m.alt_text || p.title, width: m.width, height: m.height })),
    options: options.map((o) => ({ name: o.name, values: o.values })),
    variants: variants.map((v) => {
      const limited = v.track_inventory && !v.allow_backorder;
      const left = (v.on_hand ?? 0) - (v.reserved ?? 0);
      return {
        id: v.id,
        options: v.options,
        priceMinor: Number(v.price_minor),
        compareAtMinor: v.compare_at_minor === null ? null : Number(v.compare_at_minor),
        available: !limited || left > 0,
        maxQuantity: limited ? Math.max(0, left) : null,
      };
    }),
    bookingDurationMinutes: p.booking_duration_minutes,
    bookingNoticeHours: p.booking_notice_hours,
    downloadLimit: p.download_limit,
    downloadExpiryDays: p.download_expiry_days,
  };
}

export interface ShopCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  imageId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

/** Published collections for menus and the home page, alphabetically. */
export async function navCollections(trx: Trx, limit = 24): Promise<ShopCollection[]> {
  const rows = await trx.selectFrom("collections").select(["id", "handle", "title", "description", "image_media_id", "seo_title", "seo_description"]).orderBy("title").limit(limit).execute();
  return rows.map((r) => ({ id: r.id, handle: r.handle, title: r.title, description: r.description, imageId: r.image_media_id, seoTitle: r.seo_title, seoDescription: r.seo_description }));
}

export async function collectionByHandle(trx: Trx, handle: string, sort?: CollectionSort): Promise<{ collection: ShopCollection; productIds: string[] } | undefined> {
  const r = await trx.selectFrom("collections").selectAll().where("handle", "=", handle).executeTakeFirst();
  if (!r) return undefined;
  const productIds = await productIdsIn(trx, { id: r.id, kind: r.kind, rules: r.rules as CollectionRules | null, sortOrder: sort ?? r.sort_order }, 500);
  return {
    collection: { id: r.id, handle: r.handle, title: r.title, description: r.description, imageId: r.image_media_id, seoTitle: r.seo_title, seoDescription: r.seo_description },
    productIds,
  };
}

export interface CartVariant {
  variantId: string;
  productId: string;
  handle: string;
  title: string;
  type: ProductType;
  variantTitle: string | null;
  imageId: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  available: boolean;
  maxQuantity: number | null;
  bookingNoticeHours: number | null;
  bookingDurationMinutes: number | null;
  weightGrams: number;
  taxRateBps: number | null;
}

/** Current details of the variants in a cart; variants no longer on sale are simply absent. */
export async function cartVariants(trx: Trx, ids: readonly string[]): Promise<Map<string, CartVariant>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom("variants as v")
    .innerJoin("products as p", "p.id", "v.product_id")
    .leftJoin("inventory_levels as l", "l.variant_id", "v.id")
    .select([
      "v.id",
      "v.options",
      "v.price_minor",
      "v.compare_at_minor",
      "v.track_inventory",
      "v.allow_backorder",
      "v.weight_grams",
      "l.on_hand",
      "l.reserved",
      "p.id as product_id",
      "p.handle",
      "p.title",
      "p.type",
      "p.booking_notice_hours",
      "p.booking_duration_minutes",
      "p.tax_rate_bps",
      sql<string | null>`(SELECT pm.media_id FROM app.product_media pm JOIN app.media_assets m ON m.id = pm.media_id WHERE pm.product_id = p.id AND m.kind = 'image' ORDER BY pm.position LIMIT 1)`.as("image_id"),
    ])
    .where("v.id", "in", ids)
    .execute();
  return new Map(
    rows.map((r) => {
      const limited = r.track_inventory && !r.allow_backorder;
      const left = (r.on_hand ?? 0) - (r.reserved ?? 0);
      return [
        r.id,
        {
          variantId: r.id,
          productId: r.product_id,
          handle: r.handle,
          title: r.title,
          type: r.type,
          variantTitle: r.options.length > 0 ? r.options.join(" / ") : null,
          imageId: r.image_id,
          priceMinor: Number(r.price_minor),
          compareAtMinor: r.compare_at_minor === null ? null : Number(r.compare_at_minor),
          available: !limited || left > 0,
          maxQuantity: limited ? Math.max(0, left) : null,
          bookingNoticeHours: r.booking_notice_hours,
          bookingDurationMinutes: r.booking_duration_minutes,
          weightGrams: r.weight_grams ?? 0,
          taxRateBps: r.tax_rate_bps,
        },
      ];
    }),
  );
}
