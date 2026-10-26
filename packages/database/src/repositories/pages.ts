import type { Selectable, Transaction } from "kysely";
import type { Database, StorePagesTable } from "../schema.js";

/**
 * Content pages: About us, policies, contact. The storefront's role reads
 * published pages only (a restrictive row policy), so a draft can't leak.
 */
type Trx = Transaction<Database>;

export interface StorePage {
  id: string;
  handle: string;
  title: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PageInput {
  handle: string;
  title: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
}

export const MAX_PAGES = 50;

function toPage(r: Selectable<StorePagesTable>): StorePage {
  return {
    id: r.id,
    handle: r.handle,
    title: r.title,
    body: r.body,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    published: r.published,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const row = (p: PageInput) => ({ handle: p.handle, title: p.title, body: p.body, seo_title: p.seoTitle, seo_description: p.seoDescription, published: p.published });

export async function listPages(trx: Trx): Promise<StorePage[]> {
  return (await trx.selectFrom("store_pages").selectAll().orderBy("title").limit(MAX_PAGES).execute()).map(toPage);
}

export async function getPage(trx: Trx, id: string): Promise<StorePage | undefined> {
  const r = await trx.selectFrom("store_pages").selectAll().where("id", "=", id).executeTakeFirst();
  return r ? toPage(r) : undefined;
}

export async function countPages(trx: Trx): Promise<number> {
  return Number((await trx.selectFrom("store_pages").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow()).n);
}

export async function handleTaken(trx: Trx, handle: string, exceptId?: string): Promise<boolean> {
  let q = trx.selectFrom("store_pages").select("id").where("handle", "=", handle);
  if (exceptId) q = q.where("id", "!=", exceptId);
  return Boolean(await q.executeTakeFirst());
}

export async function createPage(trx: Trx, storeId: string, p: PageInput): Promise<StorePage> {
  return toPage(await trx.insertInto("store_pages").values({ store_id: storeId, ...row(p) }).returningAll().executeTakeFirstOrThrow());
}

export async function updatePage(trx: Trx, id: string, p: PageInput): Promise<StorePage | undefined> {
  const r = await trx.updateTable("store_pages").set(row(p)).where("id", "=", id).returningAll().executeTakeFirst();
  return r ? toPage(r) : undefined;
}

export async function deletePage(trx: Trx, id: string): Promise<boolean> {
  return Number((await trx.deleteFrom("store_pages").where("id", "=", id).executeTakeFirst()).numDeletedRows) > 0;
}

/** A published page for shoppers (the public role sees no others). */
export async function publishedPage(trx: Trx, handle: string): Promise<Pick<StorePage, "handle" | "title" | "body" | "seoTitle" | "seoDescription" | "updatedAt"> | undefined> {
  const r = await trx
    .selectFrom("store_pages")
    .select(["handle", "title", "body", "seo_title", "seo_description", "updated_at"])
    .where("handle", "=", handle)
    .where("published", "=", true)
    .executeTakeFirst();
  return r ? { handle: r.handle, title: r.title, body: r.body, seoTitle: r.seo_title, seoDescription: r.seo_description, updatedAt: r.updated_at } : undefined;
}
