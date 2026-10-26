import { sql, type Transaction } from "kysely";
import type { Database, MovementReason } from "../schema.js";

/**
 * Stock per variant and the ledger of every change. All changes go through
 * recordMovement, which updates the level and appends the movement in one
 * statement pair inside the caller's transaction, so the ledger always
 * explains the current count.
 */
type Trx = Transaction<Database>;

export interface Movement {
  id: string;
  delta: number;
  onHandAfter: number;
  reason: MovementReason;
  note: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** Creates the level row for a new variant, recording its opening stock. */
export async function openLevel(trx: Trx, storeId: string, variantId: string, onHand: number, reason: MovementReason, actorId: string | null): Promise<void> {
  await trx.insertInto("inventory_levels").values({ store_id: storeId, variant_id: variantId, on_hand: onHand }).execute();
  if (onHand !== 0) {
    await trx
      .insertInto("inventory_movements")
      .values({ store_id: storeId, variant_id: variantId, delta: onHand, on_hand_after: onHand, reason, note: null, actor_id: actorId })
      .execute();
  }
}

/**
 * Changes a variant's on-hand stock by `delta` and records why. Returns the
 * new count, or undefined when the variant has no level in this store.
 */
export async function recordMovement(
  trx: Trx,
  input: { storeId: string; variantId: string; delta: number; reason: MovementReason; note?: string | null | undefined; actorId: string | null; orderId?: string | null | undefined },
): Promise<number | undefined> {
  if (input.delta === 0) {
    const level = await trx.selectFrom("inventory_levels").select("on_hand").where("variant_id", "=", input.variantId).executeTakeFirst();
    return level?.on_hand;
  }
  const level = await trx
    .updateTable("inventory_levels")
    .set((eb) => ({ on_hand: eb("on_hand", "+", input.delta) }))
    .where("variant_id", "=", input.variantId)
    .returning("on_hand")
    .executeTakeFirst();
  if (!level) return undefined;
  await trx
    .insertInto("inventory_movements")
    .values({
      store_id: input.storeId,
      variant_id: input.variantId,
      delta: input.delta,
      on_hand_after: level.on_hand,
      reason: input.reason,
      note: input.note ?? null,
      actor_id: input.actorId,
      order_id: input.orderId ?? null,
    })
    .execute();
  return level.on_hand;
}

/** Sets on-hand stock to `target`, recording the difference. */
export async function setOnHand(
  trx: Trx,
  input: { storeId: string; variantId: string; target: number; reason: MovementReason; note?: string | null | undefined; actorId: string | null },
): Promise<number | undefined> {
  // Lock the level so a concurrent change cannot slip between reading and writing.
  const current = await trx.selectFrom("inventory_levels").select("on_hand").where("variant_id", "=", input.variantId).forUpdate().executeTakeFirst();
  if (!current) return undefined;
  return recordMovement(trx, { ...input, delta: input.target - current.on_hand });
}

export type StockFilter = "all" | "low" | "out";

export interface InventoryRow {
  variantId: string;
  productId: string;
  productTitle: string;
  productStatus: string;
  imageId: string | null;
  options: string[];
  sku: string | null;
  trackInventory: boolean;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number | null;
  updatedAt: Date;
}

export interface InventoryQuery {
  q?: string | undefined;
  filter: StockFilter;
  limit: number;
  /** Keyset on (product title, variant position, variant id). */
  after?: { title: string; position: number; id: string } | undefined;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Tracked variants with their stock, by product title then variant order. */
export async function listInventory(trx: Trx, query: InventoryQuery): Promise<{ rows: Array<InventoryRow & { position: number }>; more: boolean }> {
  let q = trx
    .selectFrom("variants as v")
    .innerJoin("products as p", "p.id", "v.product_id")
    .innerJoin("inventory_levels as l", "l.variant_id", "v.id")
    .select([
      "v.id as variant_id",
      "v.position",
      "p.id as product_id",
      "p.title",
      "p.status",
      "v.options",
      "v.sku",
      "v.track_inventory",
      "l.on_hand",
      "l.reserved",
      "l.low_stock_threshold",
      "l.updated_at",
      sql<string | null>`(SELECT pm.media_id FROM app.product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1)`.as("image_id"),
    ])
    .where("v.track_inventory", "=", true)
    .where("p.status", "!=", "archived");
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    q = q.where((eb) => eb.or([eb("p.title", "ilike", pattern), eb("v.sku", "ilike", pattern)]));
  }
  if (query.filter === "out") q = q.where(sql<boolean>`l.on_hand - l.reserved <= 0`);
  if (query.filter === "low") q = q.where(sql<boolean>`l.on_hand - l.reserved > 0 AND l.on_hand - l.reserved <= coalesce(l.low_stock_threshold, 5)`);
  if (query.after) q = q.where(sql<boolean>`(p.title, v.position, v.id) > (${query.after.title}, ${query.after.position}, ${query.after.id}::uuid)`);
  const rows = await q.orderBy("p.title").orderBy("v.position").orderBy("v.id").limit(query.limit + 1).execute();
  return {
    rows: rows.slice(0, query.limit).map((r) => ({
      variantId: r.variant_id,
      position: r.position,
      productId: r.product_id,
      productTitle: r.title,
      productStatus: r.status,
      imageId: r.image_id,
      options: r.options,
      sku: r.sku,
      trackInventory: r.track_inventory,
      onHand: r.on_hand,
      reserved: r.reserved,
      available: r.on_hand - r.reserved,
      lowStockThreshold: r.low_stock_threshold,
      updatedAt: r.updated_at,
    })),
    more: rows.length > query.limit,
  };
}

export async function getLevel(trx: Trx, variantId: string): Promise<{ onHand: number; reserved: number; lowStockThreshold: number | null } | undefined> {
  const row = await trx.selectFrom("inventory_levels").select(["on_hand", "reserved", "low_stock_threshold"]).where("variant_id", "=", variantId).executeTakeFirst();
  return row ? { onHand: row.on_hand, reserved: row.reserved, lowStockThreshold: row.low_stock_threshold } : undefined;
}

export async function setThreshold(trx: Trx, variantId: string, threshold: number | null): Promise<boolean> {
  const result = await trx.updateTable("inventory_levels").set({ low_stock_threshold: threshold }).where("variant_id", "=", variantId).executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function listMovements(trx: Trx, variantId: string, limit = 50): Promise<Movement[]> {
  const rows = await trx
    .selectFrom("inventory_movements as m")
    .leftJoin("users as u", "u.id", "m.actor_id")
    .select(["m.id", "m.delta", "m.on_hand_after", "m.reason", "m.note", "m.actor_id", "u.display_name", "m.created_at"])
    .where("m.variant_id", "=", variantId)
    .orderBy("m.created_at", "desc")
    .orderBy("m.id", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    delta: r.delta,
    onHandAfter: r.on_hand_after,
    reason: r.reason,
    note: r.note,
    actorId: r.actor_id,
    actorName: r.display_name ?? null,
    createdAt: r.created_at,
  }));
}

/** Counts for the dashboard and the Inventory tabs. */
export async function stockSummary(trx: Trx): Promise<{ tracked: number; low: number; out: number }> {
  const row = await trx
    .selectFrom("inventory_levels as l")
    .innerJoin("variants as v", "v.id", "l.variant_id")
    .innerJoin("products as p", "p.id", "v.product_id")
    .select([
      sql<number>`count(*)::int`.as("tracked"),
      sql<number>`count(*) FILTER (WHERE l.on_hand - l.reserved > 0 AND l.on_hand - l.reserved <= coalesce(l.low_stock_threshold, 5))::int`.as("low"),
      sql<number>`count(*) FILTER (WHERE l.on_hand - l.reserved <= 0)::int`.as("out"),
    ])
    .where("v.track_inventory", "=", true)
    .where("p.status", "!=", "archived")
    .executeTakeFirstOrThrow();
  return row;
}
