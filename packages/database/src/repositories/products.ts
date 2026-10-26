import { sql, type Selectable, type Transaction } from "kysely";
import type { CsvProduct } from "@workeasy/commerce";
import type { Database, MovementReason, ProductStatus, ProductsTable, ProductType } from "../schema.js";
import { openLevel, setOnHand } from "./inventory.js";

/**
 * Products with their options, variants, media, files and manual-collection
 * memberships. Callers validate input (the API's schemas and
 * @workeasy/commerce); this module writes it consistently in the caller's
 * store-scoped transaction.
 */
type Trx = Transaction<Database>;

export interface VariantInput {
  /** An existing variant of this product to update; absent for a new one. */
  id?: string | undefined;
  options: string[];
  sku: string | null;
  barcode: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  costMinor: number | null;
  weightGrams: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  /** Desired on-hand stock; null leaves it as it is (0 for a new variant). */
  stock: number | null;
}

export interface ProductInput {
  type: ProductType;
  status: ProductStatus;
  title: string;
  handle: string;
  description: string;
  vendor: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  downloadLimit: number | null;
  downloadExpiryDays: number | null;
  bookingDurationMinutes: number | null;
  bookingNoticeHours: number | null;
  bookingCapacity: number | null;
  /** Weekly booking hours; null for the default hours. */
  bookingHours: Record<string, Array<[string, string]>> | null;
  /** Basis points; null for the store's default tax rate. */
  taxRateBps: number | null;
  options: Array<{ name: string; values: string[] }>;
  variants: VariantInput[];
  mediaIds: string[];
  fileIds: string[];
  /** Manual collections the product belongs to. */
  collectionIds: string[];
}

export interface Variant {
  id: string;
  position: number;
  options: string[];
  sku: string | null;
  barcode: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  costMinor: number | null;
  weightGrams: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  onHand: number;
  reserved: number;
}

export interface Product {
  id: string;
  type: ProductType;
  status: ProductStatus;
  title: string;
  handle: string;
  description: string;
  vendor: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  downloadLimit: number | null;
  downloadExpiryDays: number | null;
  bookingDurationMinutes: number | null;
  bookingNoticeHours: number | null;
  bookingCapacity: number | null;
  /** Weekly booking hours; null for the default hours. */
  bookingHours: Record<string, Array<[string, string]>> | null;
  /** Basis points; null for the store's default tax rate. */
  taxRateBps: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  options: Array<{ name: string; values: string[] }>;
  variants: Variant[];
  mediaIds: string[];
  fileIds: string[];
  collectionIds: string[];
}

const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));

function productColumns(input: ProductInput) {
  return {
    type: input.type,
    status: input.status,
    title: input.title,
    handle: input.handle,
    description: input.description,
    vendor: input.vendor,
    tags: input.tags,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    download_limit: input.type === "digital" ? input.downloadLimit : null,
    download_expiry_days: input.type === "digital" ? input.downloadExpiryDays : null,
    booking_duration_minutes: input.type === "service" ? input.bookingDurationMinutes : null,
    booking_notice_hours: input.type === "service" ? input.bookingNoticeHours : null,
    booking_capacity: input.type === "service" ? input.bookingCapacity : null,
    booking_hours: input.type === "service" ? input.bookingHours : null,
    tax_rate_bps: input.taxRateBps,
  };
}

function variantColumns(v: VariantInput, position: number) {
  return {
    position,
    options: v.options,
    sku: v.sku,
    barcode: v.barcode,
    price_minor: v.priceMinor,
    compare_at_minor: v.compareAtMinor,
    cost_minor: v.costMinor,
    weight_grams: v.weightGrams,
    track_inventory: v.trackInventory,
    allow_backorder: v.allowBackorder,
  };
}

async function replaceOptions(trx: Trx, storeId: string, productId: string, options: ProductInput["options"]): Promise<void> {
  await trx.deleteFrom("product_options").where("product_id", "=", productId).execute();
  if (options.length > 0) {
    await trx
      .insertInto("product_options")
      .values(options.map((o, position) => ({ store_id: storeId, product_id: productId, position, name: o.name, values: o.values })))
      .execute();
  }
}

async function replaceLinks(trx: Trx, storeId: string, productId: string, input: Pick<ProductInput, "mediaIds" | "fileIds" | "collectionIds">): Promise<void> {
  await trx.deleteFrom("product_media").where("product_id", "=", productId).execute();
  if (input.mediaIds.length > 0) {
    await trx.insertInto("product_media").values(input.mediaIds.map((media_id, position) => ({ store_id: storeId, product_id: productId, media_id, position }))).execute();
  }
  await trx.deleteFrom("product_files").where("product_id", "=", productId).execute();
  if (input.fileIds.length > 0) {
    await trx.insertInto("product_files").values(input.fileIds.map((media_id, position) => ({ store_id: storeId, product_id: productId, media_id, position }))).execute();
  }
  // Manual collections only: automated ones decide membership by their rules.
  const manual = input.collectionIds.length
    ? (await trx.selectFrom("collections").select("id").where("id", "in", input.collectionIds).where("kind", "=", "manual").execute()).map((c) => c.id)
    : [];
  let removal = trx.deleteFrom("collection_products").where("product_id", "=", productId);
  if (manual.length > 0) removal = removal.where("collection_id", "not in", manual);
  await removal.execute();
  for (const collectionId of manual) {
    // New members join at the end of the collection's manual order.
    await sql`
      INSERT INTO app.collection_products (store_id, collection_id, product_id, position)
      SELECT ${storeId}::uuid, ${collectionId}::uuid, ${productId}::uuid, coalesce(max(position) + 1, 0)
        FROM app.collection_products WHERE collection_id = ${collectionId}::uuid
      ON CONFLICT (collection_id, product_id) DO NOTHING`.execute(trx);
  }
}

/**
 * Writes variants: updates the given ids that belong to the product, inserts
 * new ones, deletes the rest, and moves stock to the requested counts with
 * ledger entries. Kept variants first get temporary option values and no SKU,
 * so swapping values between two variants cannot trip a uniqueness rule.
 */
async function writeVariants(trx: Trx, storeId: string, productId: string, variants: VariantInput[], actorId: string, reason: MovementReason): Promise<void> {
  const existing = await trx.selectFrom("variants").select("id").where("product_id", "=", productId).execute();
  const currentIds = new Set(existing.map((v) => v.id));
  const keep = variants.filter((v) => v.id !== undefined && currentIds.has(v.id));
  const keepIds = new Set(keep.map((v) => v.id!));
  const removed = [...currentIds].filter((id) => !keepIds.has(id));
  if (removed.length > 0) await trx.deleteFrom("variants").where("id", "in", removed).execute();
  for (const v of keep) {
    // SKUs too: two variants may trade SKUs in one save.
    await trx.updateTable("variants").set({ options: [`__moving__${v.id}`], sku: null }).where("id", "=", v.id!).execute();
  }
  for (const [position, v] of variants.entries()) {
    if (v.id !== undefined && keepIds.has(v.id)) {
      await trx.updateTable("variants").set(variantColumns(v, position)).where("id", "=", v.id).execute();
      if (v.stock !== null) await setOnHand(trx, { storeId, variantId: v.id, target: v.stock, reason, actorId });
    } else {
      const row = await trx
        .insertInto("variants")
        .values({ store_id: storeId, product_id: productId, ...variantColumns(v, position) })
        .returning("id")
        .executeTakeFirstOrThrow();
      await openLevel(trx, storeId, row.id, v.stock ?? 0, reason === "import" ? "import" : "initial", actorId);
    }
  }
}

export async function createProduct(trx: Trx, storeId: string, input: ProductInput, actorId: string): Promise<string> {
  const row = await trx
    .insertInto("products")
    .values({ store_id: storeId, ...productColumns(input), published_at: input.status === "active" ? new Date() : null })
    .returning("id")
    .executeTakeFirstOrThrow();
  await replaceOptions(trx, storeId, row.id, input.options);
  await writeVariants(trx, storeId, row.id, input.variants, actorId, "initial");
  await replaceLinks(trx, storeId, row.id, input);
  return row.id;
}

/** Replaces a product with `input`; false when it does not exist in this store. */
export async function updateProduct(trx: Trx, storeId: string, productId: string, input: ProductInput, actorId: string): Promise<boolean> {
  const updated = await trx
    .updateTable("products")
    .set({
      ...productColumns(input),
      // First activation records when the product went on sale.
      published_at: sql<Date | null>`CASE WHEN ${input.status} = 'active' THEN coalesce(published_at, now()) ELSE published_at END`,
    })
    .where("id", "=", productId)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) return false;
  await replaceOptions(trx, storeId, productId, input.options);
  await writeVariants(trx, storeId, productId, input.variants, actorId, "correction");
  await replaceLinks(trx, storeId, productId, input);
  return true;
}

export async function getProduct(trx: Trx, productId: string): Promise<Product | undefined> {
  const p = await trx.selectFrom("products").selectAll().where("id", "=", productId).executeTakeFirst();
  if (!p) return undefined;
  const [options, variants, media, files, collections] = await Promise.all([
    trx.selectFrom("product_options").select(["name", "values"]).where("product_id", "=", productId).orderBy("position").execute(),
    trx
      .selectFrom("variants as v")
      .leftJoin("inventory_levels as l", "l.variant_id", "v.id")
      .selectAll("v")
      .select(["l.on_hand", "l.reserved"])
      .where("v.product_id", "=", productId)
      .orderBy("v.position")
      .execute(),
    trx.selectFrom("product_media").select("media_id").where("product_id", "=", productId).orderBy("position").execute(),
    trx.selectFrom("product_files").select("media_id").where("product_id", "=", productId).orderBy("position").execute(),
    trx.selectFrom("collection_products").select("collection_id").where("product_id", "=", productId).execute(),
  ]);
  return {
    ...toProductFields(p),
    options: options.map((o) => ({ name: o.name, values: o.values })),
    variants: variants.map((v) => ({
      id: v.id,
      position: v.position,
      options: v.options,
      sku: v.sku,
      barcode: v.barcode,
      priceMinor: Number(v.price_minor),
      compareAtMinor: toNumber(v.compare_at_minor),
      costMinor: toNumber(v.cost_minor),
      weightGrams: v.weight_grams,
      trackInventory: v.track_inventory,
      allowBackorder: v.allow_backorder,
      onHand: v.on_hand ?? 0,
      reserved: v.reserved ?? 0,
    })),
    mediaIds: media.map((m) => m.media_id),
    fileIds: files.map((f) => f.media_id),
    collectionIds: collections.map((c) => c.collection_id),
  };
}

function toProductFields(p: Selectable<ProductsTable>) {
  return {
    id: p.id,
    type: p.type,
    status: p.status,
    title: p.title,
    handle: p.handle,
    description: p.description,
    vendor: p.vendor,
    tags: p.tags,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    downloadLimit: p.download_limit,
    downloadExpiryDays: p.download_expiry_days,
    bookingDurationMinutes: p.booking_duration_minutes,
    bookingNoticeHours: p.booking_notice_hours,
    bookingCapacity: p.booking_capacity,
    bookingHours: p.booking_hours,
    taxRateBps: p.tax_rate_bps,
    publishedAt: p.published_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export interface ProductSummary {
  id: string;
  type: ProductType;
  status: ProductStatus;
  title: string;
  handle: string;
  vendor: string | null;
  imageId: string | null;
  variantCount: number;
  priceMin: number;
  priceMax: number;
  /** On-hand stock across tracked variants; null when none is tracked. */
  stock: number | null;
  updatedAt: Date;
}

export interface ProductQuery {
  q?: string | undefined;
  status?: ProductStatus | undefined;
  type?: ProductType | undefined;
  /** Leave archived products out unless a status is asked for. */
  limit: number;
  /** Keyset: the last product of the previous page. */
  after?: { updatedAt: string; id: string } | undefined;
  ids?: readonly string[] | undefined;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Most recently changed first. */
export async function listProducts(trx: Trx, query: ProductQuery): Promise<{ items: Array<ProductSummary & { updatedAtKey: string }>; more: boolean }> {
  let q = trx
    .selectFrom("products as p")
    .select([
      "p.id",
      "p.type",
      "p.status",
      "p.title",
      "p.handle",
      "p.vendor",
      "p.updated_at",
      sql<string>`p.updated_at::text`.as("updated_at_key"),
      sql<string | null>`(SELECT pm.media_id FROM app.product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1)`.as("image_id"),
      sql<number>`(SELECT count(*) FROM app.variants v WHERE v.product_id = p.id)::int`.as("variant_count"),
      sql<string>`(SELECT coalesce(min(v.price_minor), 0) FROM app.variants v WHERE v.product_id = p.id)`.as("price_min"),
      sql<string>`(SELECT coalesce(max(v.price_minor), 0) FROM app.variants v WHERE v.product_id = p.id)`.as("price_max"),
      sql<string | null>`(SELECT sum(l.on_hand) FROM app.variants v JOIN app.inventory_levels l ON l.variant_id = v.id WHERE v.product_id = p.id AND v.track_inventory)`.as("stock"),
    ]);
  const search = query.q;
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    q = q.where((eb) =>
      eb.or([
        eb("p.title", "ilike", pattern),
        eb("p.handle", "ilike", pattern),
        eb("p.vendor", "ilike", pattern),
        eb.exists(eb.selectFrom("variants as v").select(sql`1`.as("one")).whereRef("v.product_id", "=", "p.id").where("v.sku", "ilike", pattern)),
        sql<boolean>`${search.toLowerCase()} = ANY (p.tags)`,
      ]),
    );
  }
  q = query.status ? q.where("p.status", "=", query.status) : q.where("p.status", "!=", "archived");
  if (query.type) q = q.where("p.type", "=", query.type);
  if (query.ids) q = query.ids.length ? q.where("p.id", "in", query.ids) : q.where(sql<boolean>`false`);
  if (query.after) q = q.where(sql<boolean>`(p.updated_at, p.id) < (${query.after.updatedAt}::timestamptz, ${query.after.id}::uuid)`);
  const rows = await q.orderBy("p.updated_at", "desc").orderBy("p.id", "desc").limit(query.limit + 1).execute();
  return {
    items: rows.slice(0, query.limit).map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      title: r.title,
      handle: r.handle,
      vendor: r.vendor,
      imageId: r.image_id,
      variantCount: r.variant_count,
      priceMin: Number(r.price_min),
      priceMax: Number(r.price_max),
      stock: r.stock === null ? null : Number(r.stock),
      updatedAt: r.updated_at,
      updatedAtKey: r.updated_at_key,
    })),
    more: rows.length > query.limit,
  };
}

/** Counts per status, for the Products tabs. */
export async function statusCounts(trx: Trx): Promise<Record<ProductStatus, number>> {
  const rows = await trx.selectFrom("products").select(["status", sql<number>`count(*)::int`.as("n")]).groupBy("status").execute();
  const counts: Record<ProductStatus, number> = { draft: 0, active: 0, archived: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/** Handles in use that start with `base`, for picking a free one. */
export async function handlesLike(trx: Trx, base: string): Promise<Set<string>> {
  const rows = await trx.selectFrom("products").select("handle").where("handle", "like", `${escapeLike(base)}%`).execute();
  return new Set(rows.map((r) => r.handle));
}

/** Ids among `ids` that are products of this store. */
export async function existingIds(trx: Trx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await trx.selectFrom("products").select("id").where("id", "in", ids).execute();
  return rows.map((r) => r.id);
}

export async function setStatus(trx: Trx, ids: readonly string[], status: ProductStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await trx
    .updateTable("products")
    .set({ status, published_at: sql<Date | null>`CASE WHEN ${status} = 'active' THEN coalesce(published_at, now()) ELSE published_at END` })
    .where("id", "in", ids)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Deletes products; their variants, stock, media links and memberships go with them. */
export async function deleteProducts(trx: Trx, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await trx.deleteFrom("products").where("id", "in", ids).executeTakeFirst();
  return Number(result.numDeletedRows);
}

// CSV ---------------------------------------------------------------------------------

/** Every product (archived too) in spreadsheet form, ordered by title. */
export async function exportProducts(trx: Trx): Promise<CsvProduct[]> {
  const products = await trx.selectFrom("products").selectAll().orderBy("title").orderBy("id").execute();
  const ids = products.map((p) => p.id);
  if (ids.length === 0) return [];
  const [options, variants] = await Promise.all([
    trx.selectFrom("product_options").select(["product_id", "name", "values"]).where("product_id", "in", ids).orderBy("position").execute(),
    trx
      .selectFrom("variants as v")
      .leftJoin("inventory_levels as l", "l.variant_id", "v.id")
      .selectAll("v")
      .select("l.on_hand")
      .where("v.product_id", "in", ids)
      .orderBy("v.position")
      .execute(),
  ]);
  return products.map((p) => ({
    handle: p.handle,
    title: p.title,
    type: p.type,
    status: p.status,
    description: p.description,
    vendor: p.vendor,
    tags: p.tags,
    options: options.filter((o) => o.product_id === p.id).map((o) => ({ name: o.name, values: o.values })),
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => ({
        options: v.options,
        sku: v.sku,
        barcode: v.barcode,
        priceMinor: Number(v.price_minor),
        compareAtMinor: toNumber(v.compare_at_minor),
        costMinor: toNumber(v.cost_minor),
        weightGrams: v.weight_grams,
        stock: v.track_inventory ? (v.on_hand ?? 0) : null,
        trackInventory: v.track_inventory,
      })),
  }));
}

/** Which handles already exist, to tell new products from updates in an import. */
export async function idsByHandle(trx: Trx, handles: readonly string[]): Promise<Map<string, string>> {
  if (handles.length === 0) return new Map();
  const rows = await trx.selectFrom("products").select(["id", "handle"]).where("handle", "in", handles).execute();
  return new Map(rows.map((r) => [r.handle, r.id]));
}

/**
 * Applies imported products: new handles are created; existing ones get the
 * spreadsheet's fields, options and variants (matched by option values so
 * ids and stock survive). Media, digital files and collection memberships of
 * existing products are kept; blank stock cells leave stock unchanged.
 */
export async function importProducts(trx: Trx, storeId: string, products: readonly CsvProduct[], actorId: string): Promise<{ created: number; updated: number }> {
  const existing = await idsByHandle(trx, products.map((p) => p.handle));
  let created = 0;
  let updated = 0;
  for (const p of products) {
    const id = existing.get(p.handle);
    const current = id ? await getProduct(trx, id) : undefined;
    const byKey = new Map((current?.variants ?? []).map((v) => [JSON.stringify(v.options.map((o) => o.toLowerCase())), v]));
    const input: ProductInput = {
      type: p.type,
      status: p.status,
      title: p.title,
      handle: p.handle,
      description: p.description,
      vendor: p.vendor,
      tags: p.tags,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      downloadLimit: current?.type === p.type ? current.downloadLimit : null,
      downloadExpiryDays: current?.type === p.type ? current.downloadExpiryDays : null,
      bookingDurationMinutes: current?.type === p.type ? current.bookingDurationMinutes : null,
      bookingNoticeHours: current?.type === p.type ? current.bookingNoticeHours : null,
      bookingCapacity: current?.type === p.type ? current.bookingCapacity : null,
      bookingHours: current?.type === p.type ? current.bookingHours : null,
      taxRateBps: current?.taxRateBps ?? null,
      options: p.options,
      variants: p.variants.map((v) => {
        const match = byKey.get(JSON.stringify(v.options.map((o) => o.toLowerCase())));
        return {
          id: match?.id,
          options: v.options,
          sku: v.sku,
          barcode: v.barcode,
          priceMinor: v.priceMinor,
          compareAtMinor: v.compareAtMinor,
          costMinor: v.costMinor,
          weightGrams: v.weightGrams,
          trackInventory: v.trackInventory,
          allowBackorder: match?.allowBackorder ?? false,
          stock: v.stock,
        };
      }),
      mediaIds: current?.mediaIds ?? [],
      fileIds: current?.fileIds ?? [],
      collectionIds: current?.collectionIds ?? [],
    };
    if (id && current) {
      await trx.updateTable("products").set({ ...productColumns(input) }).where("id", "=", id).execute();
      await replaceOptions(trx, storeId, id, input.options);
      await writeVariants(trx, storeId, id, input.variants, actorId, "import");
      updated++;
    } else {
      const row = await trx
        .insertInto("products")
        .values({ store_id: storeId, ...productColumns(input), published_at: input.status === "active" ? new Date() : null })
        .returning("id")
        .executeTakeFirstOrThrow();
      await replaceOptions(trx, storeId, row.id, input.options);
      await writeVariants(trx, storeId, row.id, input.variants, actorId, "import");
      created++;
    }
  }
  return { created, updated };
}

/** The unique constraint a failed write hit, to explain it ("SKU in use", "handle taken"). */
export function conflictOf(err: unknown): "handle" | "sku" | undefined {
  if (typeof err !== "object" || err === null || (err as { code?: string }).code !== "23505") return undefined;
  const constraint = (err as { constraint?: string }).constraint;
  if (constraint === "products_store_id_handle_key") return "handle";
  if (constraint === "variants_store_sku_idx") return "sku";
  return undefined;
}
