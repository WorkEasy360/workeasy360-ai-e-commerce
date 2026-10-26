import { sql, type Expression, type ExpressionBuilder, type Selectable, type SqlBool, type Transaction } from "kysely";
import type { CollectionRules, RuleCondition } from "@workeasy/commerce";
import type { CollectionKind, CollectionSort, CollectionsTable, Database } from "../schema.js";

/**
 * Collections group products for the storefront. Manual ones list their
 * products in a chosen order; automated ones match products by rules, so
 * products join and leave as they change.
 */
type Trx = Transaction<Database>;

export interface Collection {
  id: string;
  title: string;
  handle: string;
  description: string;
  kind: CollectionKind;
  rules: CollectionRules | null;
  sortOrder: CollectionSort;
  imageId: string | null;
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionInput {
  title: string;
  handle: string;
  description: string;
  kind: CollectionKind;
  rules: CollectionRules | null;
  sortOrder: CollectionSort;
  imageId: string | null;
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Manual collections: the products, in order. Ignored for automated ones. */
  productIds: string[];
}

function toCollection(r: Selectable<CollectionsTable>): Collection {
  return {
    id: r.id,
    title: r.title,
    handle: r.handle,
    description: r.description,
    kind: r.kind,
    rules: r.rules as CollectionRules | null,
    sortOrder: r.sort_order,
    imageId: r.image_media_id,
    published: r.published,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type ProductsEb = ExpressionBuilder<Database & { p: Database["products"] }, "p">;

/** One rule condition as SQL over `products as p`. Values are always bound parameters. */
function conditionSql(c: RuleCondition): Expression<SqlBool> {
  const value = c.value.trim();
  switch (c.field) {
    case "tag":
      return c.operator === "equals" ? sql<SqlBool>`${value.toLowerCase()} = ANY (p.tags)` : sql<SqlBool>`NOT (${value.toLowerCase()} = ANY (p.tags))`;
    case "type":
      return c.operator === "equals" ? sql<SqlBool>`p.type = ${value}` : sql<SqlBool>`p.type <> ${value}`;
    case "vendor":
      return c.operator === "equals" ? sql<SqlBool>`lower(p.vendor) = ${value.toLowerCase()}` : sql<SqlBool>`coalesce(lower(p.vendor), '') <> ${value.toLowerCase()}`;
    case "title":
      if (c.operator === "starts_with") return sql<SqlBool>`p.title ILIKE ${`${escapeLike(value)}%`}`;
      return c.operator === "contains" ? sql<SqlBool>`p.title ILIKE ${`%${escapeLike(value)}%`}` : sql<SqlBool>`p.title NOT ILIKE ${`%${escapeLike(value)}%`}`;
    case "price": {
      const minPrice = sql`(SELECT min(v.price_minor) FROM app.variants v WHERE v.product_id = p.id)`;
      return c.operator === "greater_than" ? sql<SqlBool>`${minPrice} > ${value}::bigint` : sql<SqlBool>`${minPrice} < ${value}::bigint`;
    }
  }
}

/** The rules as one condition: all of them, or any of them. */
export function rulesSql(eb: ProductsEb, rules: CollectionRules): Expression<SqlBool> {
  const parts = rules.conditions.map(conditionSql);
  if (parts.length === 0) return sql<SqlBool>`false`;
  return rules.match === "all" ? eb.and(parts) : eb.or(parts);
}

function orderSql(sort: CollectionSort) {
  switch (sort) {
    case "title":
      return sql`p.title, p.id`;
    case "price_asc":
      return sql`(SELECT min(v.price_minor) FROM app.variants v WHERE v.product_id = p.id) ASC NULLS LAST, p.id`;
    case "price_desc":
      return sql`(SELECT min(v.price_minor) FROM app.variants v WHERE v.product_id = p.id) DESC NULLS LAST, p.id`;
    default:
      return sql`p.created_at DESC, p.id DESC`;
  }
}

/** Product ids in the collection, in its display order. Archived products never count. */
export async function productIdsIn(trx: Trx, collection: Pick<Collection, "id" | "kind" | "rules" | "sortOrder">, limit = 250): Promise<string[]> {
  if (collection.kind === "manual") {
    let q = trx
      .selectFrom("collection_products as cp")
      .innerJoin("products as p", "p.id", "cp.product_id")
      .select("p.id")
      .where("cp.collection_id", "=", collection.id)
      .where("p.status", "!=", "archived");
    q = collection.sortOrder === "manual" ? q.orderBy("cp.position").orderBy("p.id") : q.orderBy(orderSql(collection.sortOrder));
    return (await q.limit(limit).execute()).map((r) => r.id);
  }
  if (!collection.rules) return [];
  const rules = collection.rules;
  const rows = await trx
    .selectFrom("products as p")
    .select("p.id")
    .where("p.status", "!=", "archived")
    .where((eb) => rulesSql(eb, rules))
    .orderBy(orderSql(collection.sortOrder))
    .limit(limit)
    .execute();
  return rows.map((r) => r.id);
}

export async function countProductsIn(trx: Trx, collection: Pick<Collection, "id" | "kind" | "rules">): Promise<number> {
  if (collection.kind === "manual") {
    const row = await trx
      .selectFrom("collection_products as cp")
      .innerJoin("products as p", "p.id", "cp.product_id")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("cp.collection_id", "=", collection.id)
      .where("p.status", "!=", "archived")
      .executeTakeFirstOrThrow();
    return row.n;
  }
  if (!collection.rules) return 0;
  const rules = collection.rules;
  const row = await trx
    .selectFrom("products as p")
    .select(sql<number>`count(*)::int`.as("n"))
    .where("p.status", "!=", "archived")
    .where((eb) => rulesSql(eb, rules))
    .executeTakeFirstOrThrow();
  return row.n;
}

/** Products the rules would match right now, for the editor's live preview. */
export async function previewRules(trx: Trx, rules: CollectionRules, limit = 12): Promise<{ ids: string[]; count: number }> {
  const count = await countProductsIn(trx, { id: "", kind: "automated", rules });
  const ids = await productIdsIn(trx, { id: "", kind: "automated", rules, sortOrder: "newest" }, limit);
  return { ids, count };
}

export async function listCollections(trx: Trx, q?: string): Promise<Array<Collection & { productCount: number }>> {
  let query = trx.selectFrom("collections").selectAll();
  if (q) query = query.where("title", "ilike", `%${escapeLike(q)}%`);
  const rows = await query.orderBy("title").orderBy("id").limit(500).execute();
  const result: Array<Collection & { productCount: number }> = [];
  for (const row of rows) {
    const c = toCollection(row);
    result.push({ ...c, productCount: await countProductsIn(trx, c) });
  }
  return result;
}

export async function getCollection(trx: Trx, id: string): Promise<Collection | undefined> {
  const row = await trx.selectFrom("collections").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? toCollection(row) : undefined;
}

/** Manual collections, for the product editor's "Collections" picker. */
export async function manualCollections(trx: Trx): Promise<Array<{ id: string; title: string }>> {
  return trx.selectFrom("collections").select(["id", "title"]).where("kind", "=", "manual").orderBy("title").limit(500).execute();
}

function columns(input: CollectionInput) {
  return {
    title: input.title,
    handle: input.handle,
    description: input.description,
    kind: input.kind,
    rules: input.kind === "automated" ? (input.rules as unknown as Record<string, unknown>) : null,
    sort_order: input.sortOrder,
    image_media_id: input.imageId,
    published: input.published,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
  };
}

async function replaceMembers(trx: Trx, storeId: string, collectionId: string, input: CollectionInput): Promise<void> {
  await trx.deleteFrom("collection_products").where("collection_id", "=", collectionId).execute();
  if (input.kind === "manual" && input.productIds.length > 0) {
    await trx
      .insertInto("collection_products")
      .values(input.productIds.map((product_id, position) => ({ store_id: storeId, collection_id: collectionId, product_id, position })))
      .execute();
  }
}

export async function createCollection(trx: Trx, storeId: string, input: CollectionInput): Promise<Collection> {
  const row = await trx.insertInto("collections").values({ store_id: storeId, ...columns(input) }).returningAll().executeTakeFirstOrThrow();
  await replaceMembers(trx, storeId, row.id, input);
  return toCollection(row);
}

export async function updateCollection(trx: Trx, storeId: string, id: string, input: CollectionInput): Promise<Collection | undefined> {
  const row = await trx.updateTable("collections").set(columns(input)).where("id", "=", id).returningAll().executeTakeFirst();
  if (!row) return undefined;
  await replaceMembers(trx, storeId, id, input);
  return toCollection(row);
}

export async function deleteCollection(trx: Trx, id: string): Promise<boolean> {
  const result = await trx.deleteFrom("collections").where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

/** Handles in use that start with `base`. */
export async function handlesLike(trx: Trx, base: string): Promise<Set<string>> {
  const rows = await trx.selectFrom("collections").select("handle").where("handle", "like", `${escapeLike(base)}%`).execute();
  return new Set(rows.map((r) => r.handle));
}

export function isHandleConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505" && (err as { constraint?: string }).constraint === "collections_store_id_handle_key";
}
