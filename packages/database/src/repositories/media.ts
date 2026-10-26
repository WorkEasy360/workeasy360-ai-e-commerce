import { sql, type Selectable, type Transaction } from "kysely";
import type { Db } from "../client.js";
import { withStore } from "../context.js";
import type { Database, MediaAssetsTable, MediaKind, MediaStatus, MediaVisibility } from "../schema.js";

/**
 * The Media Library. Store-scoped functions take a transaction opened with
 * withContext/withStore; the scan functions run as the worker role.
 */
type Trx = Transaction<Database>;

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  visibility: MediaVisibility;
  status: MediaStatus;
  filename: string;
  contentType: string | null;
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string;
  folder: string;
  rejectReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toAsset(r: Selectable<MediaAssetsTable>): MediaAsset {
  return {
    id: r.id,
    kind: r.kind,
    visibility: r.visibility,
    status: r.status,
    filename: r.filename,
    contentType: r.content_type,
    byteSize: Number(r.byte_size),
    width: r.width,
    height: r.height,
    altText: r.alt_text,
    folder: r.folder,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface NewUpload {
  storeId: string;
  kind: MediaKind;
  visibility: MediaVisibility;
  filename: string;
  declaredType: string;
  byteSize: number;
  storageKey: string;
  folder: string;
  createdBy: string;
}

export async function createUpload(trx: Trx, input: NewUpload): Promise<MediaAsset> {
  const row = await trx
    .insertInto("media_assets")
    .values({
      store_id: input.storeId,
      kind: input.kind,
      visibility: input.visibility,
      filename: input.filename,
      declared_type: input.declaredType,
      byte_size: input.byteSize,
      storage_key: input.storageKey,
      folder: input.folder,
      created_by: input.createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toAsset(row);
}

/** Moves an upload the browser finished sending to scanning; undefined unless it was still uploading. */
export async function markScanning(trx: Trx, id: string): Promise<MediaAsset | undefined> {
  const row = await trx.updateTable("media_assets").set({ status: "scanning" }).where("id", "=", id).where("status", "=", "uploading").returningAll().executeTakeFirst();
  return row ? toAsset(row) : undefined;
}

export async function getMedia(trx: Trx, id: string): Promise<MediaAsset | undefined> {
  const row = await trx.selectFrom("media_assets").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? toAsset(row) : undefined;
}

/** The private storage key, for signed downloads and deletion. */
export async function storageKeyOf(trx: Trx, id: string): Promise<string | undefined> {
  const row = await trx.selectFrom("media_assets").select("storage_key").where("id", "=", id).executeTakeFirst();
  return row?.storage_key;
}

export interface MediaQuery {
  q?: string | undefined;
  kind?: MediaKind | undefined;
  /** Only assets that finished scanning; pickers use this. */
  readyOnly?: boolean | undefined;
  limit: number;
  /** Keyset: the last asset of the previous page. */
  after?: { createdAt: string; id: string } | undefined;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Newest first, with how many products and collections use each asset. */
export async function listMedia(trx: Trx, query: MediaQuery): Promise<{ items: Array<MediaAsset & { usage: number; createdAtKey: string }>; more: boolean }> {
  let q = trx
    .selectFrom("media_assets as m")
    .selectAll("m")
    .select([
      sql<string>`m.created_at::text`.as("created_at_key"),
      sql<number>`(SELECT count(*) FROM app.product_media pm WHERE pm.media_id = m.id)
        + (SELECT count(*) FROM app.product_files pf WHERE pf.media_id = m.id)
        + (SELECT count(*) FROM app.collections c WHERE c.image_media_id = m.id)`.as("usage"),
    ]);
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    q = q.where((eb) => eb.or([eb("m.filename", "ilike", pattern), eb("m.alt_text", "ilike", pattern), eb("m.folder", "ilike", pattern)]));
  }
  if (query.kind) q = q.where("m.kind", "=", query.kind);
  if (query.readyOnly) q = q.where("m.status", "=", "ready");
  if (query.after) q = q.where(sql<boolean>`(m.created_at, m.id) < (${query.after.createdAt}::timestamptz, ${query.after.id}::uuid)`);
  const rows = await q.orderBy("m.created_at", "desc").orderBy("m.id", "desc").limit(query.limit + 1).execute();
  return {
    items: rows.slice(0, query.limit).map((r) => ({ ...toAsset(r), usage: Number(r.usage), createdAtKey: r.created_at_key })),
    more: rows.length > query.limit,
  };
}

export interface MediaUsage {
  products: Array<{ id: string; title: string; as: "media" | "file" }>;
  collections: Array<{ id: string; title: string }>;
}

export async function mediaUsage(trx: Trx, id: string): Promise<MediaUsage> {
  const media = await trx
    .selectFrom("product_media as pm")
    .innerJoin("products as p", "p.id", "pm.product_id")
    .select(["p.id", "p.title"])
    .where("pm.media_id", "=", id)
    .execute();
  const files = await trx
    .selectFrom("product_files as pf")
    .innerJoin("products as p", "p.id", "pf.product_id")
    .select(["p.id", "p.title"])
    .where("pf.media_id", "=", id)
    .execute();
  const collections = await trx.selectFrom("collections").select(["id", "title"]).where("image_media_id", "=", id).execute();
  return {
    products: [...media.map((p) => ({ ...p, as: "media" as const })), ...files.map((p) => ({ ...p, as: "file" as const }))],
    collections,
  };
}

export async function updateMedia(trx: Trx, id: string, patch: { altText?: string | undefined; folder?: string | undefined; filename?: string | undefined }): Promise<MediaAsset | undefined> {
  const row = await trx
    .updateTable("media_assets")
    .set({
      ...(patch.altText === undefined ? {} : { alt_text: patch.altText }),
      ...(patch.folder === undefined ? {} : { folder: patch.folder }),
      ...(patch.filename === undefined ? {} : { filename: patch.filename }),
    })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
  return row ? toAsset(row) : undefined;
}

/**
 * Removes an asset's row and returns where its object was, for the caller to
 * delete. Fails with a restrict violation (23001) while a digital product
 * still delivers the file; images are simply detached from products.
 */
export async function deleteMedia(trx: Trx, id: string): Promise<{ storageKey: string; status: MediaStatus } | undefined> {
  const row = await trx.deleteFrom("media_assets").where("id", "=", id).returning(["storage_key", "status"]).executeTakeFirst();
  return row ? { storageKey: row.storage_key, status: row.status } : undefined;
}

/** Ids among `ids` that are ready assets of `kind` in the current store, in the order given. */
export async function readyIds(trx: Trx, ids: readonly string[], kinds: readonly MediaKind[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await trx.selectFrom("media_assets").select("id").where("id", "in", ids).where("status", "=", "ready").where("kind", "in", kinds).execute();
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}

// Worker side -----------------------------------------------------------------------

export interface ScanTarget {
  id: string;
  storeId: string;
  kind: MediaKind;
  status: MediaStatus;
  declaredType: string;
  byteSize: number;
  storageKey: string;
}

export async function getScanTarget(workerDb: Db, storeId: string, id: string): Promise<ScanTarget | undefined> {
  const row = await withStore(workerDb, storeId, (trx) =>
    trx.selectFrom("media_assets").select(["id", "store_id", "kind", "status", "declared_type", "byte_size", "storage_key"]).where("id", "=", id).executeTakeFirst(),
  );
  return row
    ? { id: row.id, storeId: row.store_id, kind: row.kind, status: row.status, declaredType: row.declared_type, byteSize: Number(row.byte_size), storageKey: row.storage_key }
    : undefined;
}

export type ScanOutcome =
  | { outcome: "ready"; contentType: string; width: number | null; height: number | null }
  | { outcome: "rejected"; reason: string };

/** Records a scan's result, only while the asset is still being scanned. */
export async function finishScan(workerDb: Db, target: Pick<ScanTarget, "id" | "storeId">, result: ScanOutcome): Promise<boolean> {
  const updated = await withStore(workerDb, target.storeId, (trx) =>
    trx
      .updateTable("media_assets")
      .set(
        result.outcome === "ready"
          ? { status: "ready", content_type: result.contentType, width: result.width, height: result.height, reject_reason: null }
          : { status: "rejected", reject_reason: result.reason },
      )
      .where("id", "=", target.id)
      .where("status", "=", "scanning")
      .executeTakeFirst(),
  );
  return Number(updated.numUpdatedRows) > 0;
}

/** A ready, public asset for the storefront, without a store context (public role). */
export async function resolvePublicMedia(publicDb: Db, id: string): Promise<{ storageKey: string; contentType: string } | undefined> {
  const { rows } = await sql<{ storage_key: string; content_type: string | null }>`SELECT storage_key, content_type FROM app.resolve_public_media(${id}::uuid)`.execute(publicDb);
  const row = rows[0];
  return row ? { storageKey: row.storage_key, contentType: row.content_type ?? "application/octet-stream" } : undefined;
}
