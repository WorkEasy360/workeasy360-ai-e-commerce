import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { Database, ReviewStatus } from "../schema.js";
import { appendOutbox } from "./audit.js";

/**
 * Reviews: written by buyers about products in their orders, moderated by
 * the merchant. Also the emailed review link, which lets a buyer review
 * without their order link.
 */
type Trx = Transaction<Database>;

export const REVIEW_REQUEST_DAYS_VALID = 60;
export const REVIEW_REQUESTED_V1 = "review.request_due.v1";

export interface Review {
  id: string;
  productId: string;
  productTitle: string;
  orderId: string;
  orderNumber: number;
  authorName: string;
  email: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  reply: string | null;
  repliedAt: Date | null;
  createdAt: Date;
}

/** "Asha Rao" → "Asha R.": enough to feel real, not enough to find someone. */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Customer";
  const first = parts[0]!.slice(0, 40);
  return parts.length > 1 ? `${first} ${parts.at(-1)![0]!.toUpperCase()}.` : first;
}

export interface ReviewSettings {
  autoPublish: boolean;
  requestAfterDays: number | null;
}

export async function getReviewSettings(trx: Trx): Promise<ReviewSettings> {
  const r = await trx.selectFrom("review_settings").selectAll().executeTakeFirst();
  return r ? { autoPublish: r.auto_publish, requestAfterDays: r.request_after_days } : { autoPublish: false, requestAfterDays: 5 };
}

export async function saveReviewSettings(trx: Trx, storeId: string, s: ReviewSettings): Promise<ReviewSettings> {
  const values = { auto_publish: s.autoPublish, request_after_days: s.requestAfterDays };
  await trx
    .insertInto("review_settings")
    .values({ store_id: storeId, ...values })
    .onConflict((oc) => oc.column("store_id").doUpdateSet(values))
    .execute();
  return getReviewSettings(trx);
}

// What a buyer can review ------------------------------------------------------------------------

export interface Reviewable {
  productId: string;
  title: string;
  imageId: string | null;
  review: { rating: number; title: string | null; body: string; status: ReviewStatus } | null;
}

/** An order's products a buyer can review, once paid or fulfilled, each with their review if written. */
export async function reviewableItems(trx: Trx, orderId: string): Promise<Reviewable[] | "not_yet"> {
  const order = await trx.selectFrom("orders").select(["status", "payment_status", "fulfillment_status"]).where("id", "=", orderId).executeTakeFirst();
  if (!order || order.status !== "open" || (order.payment_status === "pending" && order.fulfillment_status === "unfulfilled")) return "not_yet";
  const items = await trx
    .selectFrom("order_items as i")
    .innerJoin("products as p", "p.id", "i.product_id")
    .leftJoin("reviews as r", (j) => j.onRef("r.product_id", "=", "i.product_id").onRef("r.order_id", "=", "i.order_id"))
    .select(["i.product_id", "i.title", "i.image_media_id", "r.rating", "r.title as review_title", "r.body", "r.status"])
    .where("i.order_id", "=", orderId)
    .orderBy("i.position")
    .execute();
  const seen = new Set<string>();
  return items
    .filter((i) => i.product_id !== null && !seen.has(i.product_id) && seen.add(i.product_id))
    .map((i) => ({
      productId: i.product_id!,
      title: i.title,
      imageId: i.image_media_id,
      review: i.rating === null ? null : { rating: i.rating, title: i.review_title, body: i.body ?? "", status: i.status! },
    }));
}

/**
 * A buyer's review of a product in their order. Ratings of 4 or 5 go live at
 * once when the merchant allows; everything else waits for them.
 */
export async function submitReview(
  trx: Trx,
  input: { storeId: string; orderId: string; productId: string; rating: number; title: string | null; body: string },
): Promise<{ kind: "created"; status: ReviewStatus } | { kind: "already" } | { kind: "not_allowed" }> {
  const items = await reviewableItems(trx, input.orderId);
  if (items === "not_yet") return { kind: "not_allowed" };
  const item = items.find((i) => i.productId === input.productId);
  if (!item) return { kind: "not_allowed" };
  if (item.review) return { kind: "already" };
  const order = await trx.selectFrom("orders").select(["customer_id", "name"]).where("id", "=", input.orderId).executeTakeFirstOrThrow();
  const settings = await getReviewSettings(trx);
  const status: ReviewStatus = settings.autoPublish && input.rating >= 4 ? "published" : "pending";
  await trx
    .insertInto("reviews")
    .values({
      store_id: input.storeId,
      product_id: input.productId,
      order_id: input.orderId,
      customer_id: order.customer_id,
      author_name: publicName(order.name),
      rating: input.rating,
      title: input.title,
      body: input.body,
      status,
    })
    .execute();
  return { kind: "created", status };
}

// The emailed review link ------------------------------------------------------------------------

export function hashReviewToken(token: string): Buffer {
  return createHash("sha256").update(`review:${token}`, "utf8").digest();
}

/** Creates (or replaces) an order's review link; returns the token to email. */
export async function createReviewRequest(trx: Trx, storeId: string, orderId: string, now = new Date()): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const values = { token_hash: hashReviewToken(token), expires_at: new Date(now.getTime() + REVIEW_REQUEST_DAYS_VALID * 86_400_000) };
  await trx
    .insertInto("review_requests")
    .values({ store_id: storeId, order_id: orderId, ...values })
    .onConflict((oc) => oc.column("order_id").doUpdateSet(values))
    .execute();
  return token;
}

export async function orderForReviewToken(trx: Trx, token: string, now = new Date()): Promise<string | undefined> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return undefined;
  const r = await trx.selectFrom("review_requests").select(["order_id", "expires_at"]).where("token_hash", "=", hashReviewToken(token)).executeTakeFirst();
  return r && r.expires_at > now ? r.order_id : undefined;
}

/** Schedules the review email for when a fully fulfilled order is a few days old. */
export async function scheduleReviewRequest(trx: Trx, storeId: string, orderId: string): Promise<void> {
  await appendOutbox(trx, { id: randomUUID(), storeId, eventType: REVIEW_REQUESTED_V1, aggregateId: orderId, occurredAt: new Date(), payload: { orderId } });
}

// Showing reviews ------------------------------------------------------------------------------

export interface RatingSummary {
  average: number | null;
  count: number;
  /** Counts for 5 stars down to 1. */
  histogram: [number, number, number, number, number];
}

export async function ratingSummary(trx: Trx, productId?: string): Promise<RatingSummary> {
  let q = trx.selectFrom("reviews").select(["rating", sql<number>`count(*)::int`.as("n")]).where("status", "=", "published").groupBy("rating");
  if (productId) q = q.where("product_id", "=", productId);
  const rows = await q.execute();
  const histogram: RatingSummary["histogram"] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    histogram[5 - r.rating] = r.n;
    sum += r.rating * r.n;
    count += r.n;
  }
  return { average: count ? Math.round((sum / count) * 10) / 10 : null, count, histogram };
}

export async function publishedReviews(trx: Trx, productId: string, limit: number, offset: number) {
  return trx
    .selectFrom("reviews")
    .select(["id", "author_name", "rating", "title", "body", "reply", "created_at"])
    .where("product_id", "=", productId)
    .where("status", "=", "published")
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();
}

/** Average rating and count per product, for product cards. */
export async function ratingsFor(trx: Trx, productIds: readonly string[]): Promise<Map<string, { average: number; count: number }>> {
  if (productIds.length === 0) return new Map();
  const rows = await trx
    .selectFrom("reviews")
    .select(["product_id", sql<string>`avg(rating)`.as("avg"), sql<number>`count(*)::int`.as("n")])
    .where("status", "=", "published")
    .where("product_id", "in", productIds)
    .groupBy("product_id")
    .execute();
  return new Map(rows.map((r) => [r.product_id, { average: Math.round(Number(r.avg) * 10) / 10, count: r.n }]));
}

// Moderation -------------------------------------------------------------------------------------

export interface ReviewQuery {
  id?: string | undefined;
  status?: ReviewStatus | undefined;
  rating?: number | undefined;
  q?: string | undefined;
  limit: number;
  offset: number;
}

export async function listReviews(trx: Trx, query: ReviewQuery): Promise<{ items: Review[]; total: number }> {
  let q = trx.selectFrom("reviews as r").innerJoin("products as p", "p.id", "r.product_id").innerJoin("orders as o", "o.id", "r.order_id");
  if (query.id) q = q.where("r.id", "=", query.id);
  if (query.status) q = q.where("r.status", "=", query.status);
  if (query.rating) q = q.where("r.rating", "=", query.rating);
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    q = q.where((eb) => eb.or([eb("r.body", "ilike", pattern), eb("r.title", "ilike", pattern), eb("p.title", "ilike", pattern), eb("r.author_name", "ilike", pattern)]));
  }
  const total = (await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow()).n;
  const rows = await q
    .select(["r.id", "r.product_id", "p.title as product_title", "r.order_id", "o.number", "o.email", "r.author_name", "r.rating", "r.title", "r.body", "r.status", "r.reply", "r.replied_at", "r.created_at"])
    .orderBy("r.created_at", "desc")
    .orderBy("r.id")
    .limit(query.limit)
    .offset(query.offset)
    .execute();
  return {
    items: rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productTitle: r.product_title,
      orderId: r.order_id,
      orderNumber: r.number,
      authorName: r.author_name,
      email: r.email,
      rating: r.rating,
      title: r.title,
      body: r.body,
      status: r.status,
      reply: r.reply,
      repliedAt: r.replied_at,
      createdAt: r.created_at,
    })),
    total,
  };
}

export async function reviewCounts(trx: Trx): Promise<Record<ReviewStatus, number>> {
  const rows = await trx.selectFrom("reviews").select(["status", sql<number>`count(*)::int`.as("n")]).groupBy("status").execute();
  const counts: Record<ReviewStatus, number> = { pending: 0, published: 0, hidden: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

export async function moderateReview(trx: Trx, id: string, patch: { status?: ReviewStatus | undefined; reply?: string | null | undefined }): Promise<boolean> {
  const set: { status?: ReviewStatus; reply?: string | null; replied_at?: Date | null } = {};
  if (patch.status) set.status = patch.status;
  if (patch.reply !== undefined) {
    set.reply = patch.reply;
    set.replied_at = patch.reply ? new Date() : null;
  }
  if (Object.keys(set).length === 0) return (await trx.selectFrom("reviews").select("id").where("id", "=", id).executeTakeFirst()) !== undefined;
  const r = await trx.updateTable("reviews").set(set).where("id", "=", id).returning("id").executeTakeFirst();
  return r !== undefined;
}

export async function deleteReview(trx: Trx, id: string): Promise<boolean> {
  return Number((await trx.deleteFrom("reviews").where("id", "=", id).executeTakeFirst()).numDeletedRows) > 0;
}
