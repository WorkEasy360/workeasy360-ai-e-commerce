import express, { type Router } from "express";
import { handleize, parseProductCsv, productsToCsv, uniqueHandle, variantKey } from "@workeasy/commerce";
import { auditRepo, mediaRepo, productsRepo, storesRepo, type Product, type ProductInput, type ProductSummary } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { BulkProductsBodySchema, ImportQuerySchema, ProductBodySchema, ProductListQuerySchema, type ProductBody } from "../contract/catalog.js";
import { problems } from "../http/problem.js";
import { actorOf, decodeCursor, encodeCursor, invalid, issuesToErrors, respond, UUID_PATTERN, type Failure, type StoreAccess, type Trx } from "./support.js";

/** Product shapes on the wire: dates as ISO strings. */
export function productJson(p: Product) {
  return {
    ...p,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function productSummaryJson(p: ProductSummary) {
  return { ...p, updatedAt: p.updatedAt.toISOString() };
}

const SKU_TAKEN = { kind: "conflict", code: "SKU_TAKEN", title: "Another product already uses one of these SKUs" } as const;
const HANDLE_TAKEN = { kind: "conflict", code: "HANDLE_TAKEN", title: "Another product already uses this URL handle" } as const;

function conflictOutcome(err: unknown): Failure | undefined {
  const conflict = productsRepo.conflictOf(err);
  if (conflict === "sku") return SKU_TAKEN;
  if (conflict === "handle") return HANDLE_TAKEN;
  return undefined;
}

/**
 * Checks the ids a product links to: ready images or videos for its media,
 * ready private files for its downloads, and this store's collections. Row
 * security already hides other stores' rows; this also catches unfinished
 * uploads.
 */
async function linkProblems(trx: Trx, body: ProductBody): Promise<Failure | undefined> {
  const media = await mediaRepo.readyIds(trx, body.mediaIds, ["image", "video"]);
  if (media.length !== new Set(body.mediaIds).size) return invalid("mediaIds", "Some images aren't ready yet or no longer exist");
  const files = await mediaRepo.readyIds(trx, body.fileIds, ["file"]);
  if (files.length !== new Set(body.fileIds).size) return invalid("fileIds", "Some files aren't ready yet or no longer exist");
  if (body.collectionIds.length > 0) {
    const found = await trx.selectFrom("collections").select("id").where("id", "in", body.collectionIds).execute();
    if (found.length !== new Set(body.collectionIds).size) return invalid("collectionIds", "Some collections no longer exist");
  }
  return undefined;
}

function toInput(body: ProductBody, handle: string): ProductInput {
  return {
    ...body,
    handle,
    mediaIds: [...new Set(body.mediaIds)],
    fileIds: [...new Set(body.fileIds)],
    collectionIds: [...new Set(body.collectionIds)],
    variants: body.variants.map((v) => ({ ...v, id: v.id })),
    bookingHours: body.bookingHours,
  };
}

export function productsRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  router.get("/stores/:storeId/products", async (req, res) => {
    const query = ProductListQuerySchema.safeParse(req.query);
    if (!query.success) {
      problems.validation(res, issuesToErrors(query.error));
      return;
    }
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : undefined;
    if (query.data.cursor && !cursor) {
      problems.validation(res, [{ field: "cursor", code: "INVALID", message: "Invalid cursor" }]);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.read", async (trx) => {
        const page = await productsRepo.listProducts(trx, {
          q: query.data.q,
          status: query.data.status,
          type: query.data.type,
          limit: query.data.limit,
          after: cursor ? { updatedAt: cursor.at, id: cursor.id } : undefined,
        });
        const last = page.items.at(-1);
        return {
          kind: "ok",
          body: {
            items: page.items.map(({ updatedAtKey: _key, ...p }) => productSummaryJson(p)),
            counts: await productsRepo.statusCounts(trx),
            ...(page.more && last ? { nextCursor: encodeCursor({ at: last.updatedAtKey, id: last.id }) } : {}),
          },
        };
      }),
    );
  });

  router.post("/stores/:storeId/products", async (req, res) => {
    const body = ProductBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    // A handle the merchant typed must be free; one made from the title gets a number if needed.
    const explicitHandle = typeof req.body?.handle === "string" && req.body.handle.trim() !== "";
    try {
      respond(
        res,
        await withPermission(res, req.params.storeId, "products.manage", async (trx, _m, userId) => {
          const problem = await linkProblems(trx, body.data);
          if (problem) return problem;
          const handle = explicitHandle ? body.data.handle : uniqueHandle(body.data.handle || "product", await productsRepo.handlesLike(trx, body.data.handle || "product"));
          const id = await productsRepo.createProduct(trx, req.params.storeId, toInput(body.data, handle), userId);
          await auditRepo.appendAudit(trx, {
            storeId: req.params.storeId,
            ...actorOf(res),
            action: "product.created",
            resourceType: "product",
            resourceId: id,
            metadata: { title: body.data.title, type: body.data.type, status: body.data.status, variants: body.data.variants.length },
          });
          const product = (await productsRepo.getProduct(trx, id))!;
          return { kind: "ok", status: 201, body: { product: productJson(product) }, headers: { Location: `/api/v1/stores/${req.params.storeId}/products/${id}` } };
        }),
      );
    } catch (err) {
      const conflict = conflictOutcome(err);
      if (!conflict) throw err;
      respond(res, conflict);
    }
  });

  router.get("/stores/:storeId/products/export.csv", async (req, res) => {
    const outcome = await withPermission(res, req.params.storeId, "products.read", async (trx) => {
      const store = (await storesRepo.getStore(trx))!;
      return { kind: "ok", body: { csv: productsToCsv(await productsRepo.exportProducts(trx), store.currency), slug: store.slug } };
    });
    if (typeof outcome === "symbol" || outcome.kind !== "ok") {
      respond(res, outcome);
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .type("text/csv; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${outcome.body.slug}-products-${date}.csv"`)
      // A byte-order mark makes Excel read the file as UTF-8.
      .send(`﻿${outcome.body.csv}`);
  });

  /**
   * Imports a product spreadsheet sent as text/csv. With dryRun (the default)
   * nothing changes: the response previews what would be created or updated
   * and lists every problem by row. Without it, the valid products are
   * written in one transaction.
   */
  router.post("/stores/:storeId/products/import", express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }), async (req, res) => {
    const query = ImportQuerySchema.safeParse(req.query);
    if (!query.success || typeof req.body !== "string") {
      problems.validation(res, [{ field: "body", code: "INVALID", message: "Send the spreadsheet as text/csv" }]);
      return;
    }
    const text = req.body;
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.manage", async (trx, _m, userId) => {
        const store = (await storesRepo.getStore(trx))!;
        const parsed = parseProductCsv(text, store.currency);
        const existing = await productsRepo.idsByHandle(trx, parsed.products.map((p) => p.handle));
        const preview = [];
        for (const p of parsed.products) {
          const id = existing.get(p.handle);
          // A spreadsheet replaces a product's variants: say how many an update would remove.
          const current = id ? await productsRepo.getProduct(trx, id) : undefined;
          const keys = new Set(p.variants.map((v) => variantKey(v.options)));
          const removesVariants = current ? current.variants.filter((v) => !keys.has(variantKey(v.options))).length : 0;
          preview.push({ handle: p.handle, title: p.title, variants: p.variants.length, action: id ? ("update" as const) : ("create" as const), removesVariants });
        }
        const summary = {
          products: preview,
          problems: parsed.problems,
          create: preview.filter((p) => p.action === "create").length,
          update: preview.filter((p) => p.action === "update").length,
        };
        if (query.data.dryRun) return { kind: "ok", body: { ...summary, applied: false } };
        if (parsed.products.length === 0) return invalid("body", parsed.problems[0]?.message ?? "Nothing to import");
        const result = await productsRepo.importProducts(trx, req.params.storeId, parsed.products, userId);
        await auditRepo.appendAudit(trx, {
          storeId: req.params.storeId,
          ...actorOf(res),
          action: "products.imported",
          resourceType: "store",
          resourceId: req.params.storeId,
          metadata: { created: result.created, updated: result.updated, skippedRows: parsed.problems.length },
        });
        return { kind: "ok", body: { ...summary, applied: true } };
      }).catch((err: unknown) => {
        const conflict = conflictOutcome(err);
        if (conflict) return conflict;
        throw err;
      }),
    );
  });

  router.post("/stores/:storeId/products/bulk", async (req, res) => {
    const body = BulkProductsBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const { ids, action } = body.data;
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.manage", async (trx) => {
        const found = await productsRepo.existingIds(trx, [...new Set(ids)]);
        const changed =
          action === "delete"
            ? await productsRepo.deleteProducts(trx, found)
            : await productsRepo.setStatus(trx, found, action === "activate" ? "active" : action === "draft" ? "draft" : "archived");
        for (const id of found) {
          await auditRepo.appendAudit(trx, {
            storeId: req.params.storeId,
            ...actorOf(res),
            action: action === "delete" ? "product.deleted" : "product.status_changed",
            resourceType: "product",
            resourceId: id,
            metadata: action === "delete" ? {} : { status: action === "activate" ? "active" : action === "draft" ? "draft" : "archived" },
          });
        }
        return { kind: "ok", body: { changed } };
      }),
    );
  });

  router.get("/stores/:storeId/products/:productId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.productId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.read", async (trx) => {
        const product = await productsRepo.getProduct(trx, req.params.productId);
        return product ? { kind: "ok", body: { product: productJson(product) } } : { kind: "not_found" };
      }),
    );
  });

  router.put("/stores/:storeId/products/:productId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.productId)) {
      problems.notFound(res);
      return;
    }
    const body = ProductBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    try {
      respond(
        res,
        await withPermission(res, req.params.storeId, "products.manage", async (trx, _m, userId) => {
          const before = await productsRepo.getProduct(trx, req.params.productId);
          if (!before) return { kind: "not_found" };
          const problem = await linkProblems(trx, body.data);
          if (problem) return problem;
          const handle = body.data.handle || handleize(body.data.title) || before.handle;
          await productsRepo.updateProduct(trx, req.params.storeId, req.params.productId, toInput(body.data, handle), userId);
          const after = (await productsRepo.getProduct(trx, req.params.productId))!;
          const fields = (["title", "handle", "status", "type", "description", "vendor", "tags", "seoTitle", "seoDescription"] as const).filter(
            (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
          );
          await auditRepo.appendAudit(trx, {
            storeId: req.params.storeId,
            ...actorOf(res),
            action: "product.updated",
            resourceType: "product",
            resourceId: after.id,
            metadata: { fields, variants: { before: before.variants.length, after: after.variants.length }, ...(fields.includes("status") ? { status: after.status } : {}) },
          });
          return { kind: "ok", body: { product: productJson(after) } };
        }),
      );
    } catch (err) {
      const conflict = conflictOutcome(err);
      if (!conflict) throw err;
      respond(res, conflict);
    }
  });

  router.delete("/stores/:storeId/products/:productId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.productId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.manage", async (trx) => {
        const deleted = await productsRepo.deleteProducts(trx, [req.params.productId]);
        if (deleted === 0) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "product.deleted", resourceType: "product", resourceId: req.params.productId });
        return { kind: "ok", body: { deleted: true } };
      }),
    );
  });
}
