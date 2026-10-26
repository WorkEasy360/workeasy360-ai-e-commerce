import type { Router } from "express";
import { uniqueHandle } from "@workeasy/commerce";
import { auditRepo, collectionsRepo, mediaRepo, productsRepo, type Collection } from "@workeasy/database";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { CollectionBodySchema, RulesSchema } from "../contract/catalog.js";
import { problems } from "../http/problem.js";
import { productSummaryJson } from "./products.js";
import { actorOf, invalid, issuesToErrors, respond, UUID_PATTERN, type Failure, type StoreAccess, type Trx } from "./support.js";

function collectionJson(c: Collection) {
  return { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

const HANDLE_TAKEN = { kind: "conflict", code: "HANDLE_TAKEN", title: "Another collection already uses this URL handle" } as const;

/** The collection's products as list rows, in the collection's order. */
async function productRows(trx: Trx, ids: string[]) {
  const page = await productsRepo.listProducts(trx, { ids, status: undefined, limit: ids.length || 1 });
  // listProducts hides archived products unless asked, which matches the storefront.
  const byId = new Map(page.items.map(({ updatedAtKey: _key, ...p }) => [p.id, productSummaryJson(p)]));
  return ids.map((id) => byId.get(id)).filter((p) => p !== undefined);
}

type CollectionBody = z.infer<typeof CollectionBodySchema>;

async function checkLinks(trx: Trx, body: CollectionBody): Promise<Failure | undefined> {
  if (body.imageId && (await mediaRepo.readyIds(trx, [body.imageId], ["image"])).length === 0) return invalid("imageId", "That image isn't ready or no longer exists");
  if (body.kind === "manual" && (await productsRepo.existingIds(trx, body.productIds)).length !== body.productIds.length) {
    return invalid("productIds", "Some products no longer exist");
  }
  return undefined;
}

export function collectionsRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  router.get("/stores/:storeId/collections", async (req, res) => {
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().slice(0, 200) : undefined;
    const manualOnly = req.query.kind === "manual";
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.read", async (trx) => {
        if (manualOnly) return { kind: "ok", body: { items: await collectionsRepo.manualCollections(trx) } };
        const items = await collectionsRepo.listCollections(trx, q);
        return { kind: "ok", body: { items: items.map((c) => ({ ...collectionJson(c), productCount: c.productCount })) } };
      }),
    );
  });

  /** Products the given rules match right now, for the editor's live preview. */
  router.post("/stores/:storeId/collections/preview", async (req, res) => {
    const body = z.object({ rules: RulesSchema }).safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.read", async (trx) => {
        const preview = await collectionsRepo.previewRules(trx, body.data.rules);
        return { kind: "ok", body: { count: preview.count, products: await productRows(trx, preview.ids) } };
      }),
    );
  });

  router.post("/stores/:storeId/collections", async (req, res) => {
    const body = CollectionBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const explicitHandle = typeof req.body?.handle === "string" && req.body.handle.trim() !== "";
    try {
      respond(
        res,
        await withPermission(res, req.params.storeId, "products.manage", async (trx) => {
          const problem = await checkLinks(trx, body.data);
          if (problem) return problem;
          const handle = explicitHandle ? body.data.handle : uniqueHandle(body.data.handle || "collection", await collectionsRepo.handlesLike(trx, body.data.handle || "collection"));
          const created = await collectionsRepo.createCollection(trx, req.params.storeId, { ...body.data, handle });
          await auditRepo.appendAudit(trx, {
            storeId: req.params.storeId,
            ...actorOf(res),
            action: "collection.created",
            resourceType: "collection",
            resourceId: created.id,
            metadata: { title: created.title, kind: created.kind },
          });
          return { kind: "ok", status: 201, body: { collection: collectionJson(created) } };
        }),
      );
    } catch (err) {
      if (!collectionsRepo.isHandleConflict(err)) throw err;
      respond(res, HANDLE_TAKEN);
    }
  });

  router.get("/stores/:storeId/collections/:collectionId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.collectionId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.read", async (trx) => {
        const collection = await collectionsRepo.getCollection(trx, req.params.collectionId);
        if (!collection) return { kind: "not_found" };
        const ids = await collectionsRepo.productIdsIn(trx, collection, 1000);
        return {
          kind: "ok",
          body: { collection: collectionJson(collection), productCount: await collectionsRepo.countProductsIn(trx, collection), products: await productRows(trx, ids) },
        };
      }),
    );
  });

  router.put("/stores/:storeId/collections/:collectionId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.collectionId)) {
      problems.notFound(res);
      return;
    }
    const body = CollectionBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    try {
      respond(
        res,
        await withPermission(res, req.params.storeId, "products.manage", async (trx) => {
          const before = await collectionsRepo.getCollection(trx, req.params.collectionId);
          if (!before) return { kind: "not_found" };
          const problem = await checkLinks(trx, body.data);
          if (problem) return problem;
          const updated = (await collectionsRepo.updateCollection(trx, req.params.storeId, req.params.collectionId, { ...body.data, handle: body.data.handle || before.handle }))!;
          await auditRepo.appendAudit(trx, {
            storeId: req.params.storeId,
            ...actorOf(res),
            action: "collection.updated",
            resourceType: "collection",
            resourceId: updated.id,
            metadata: { title: updated.title, kind: updated.kind },
          });
          return { kind: "ok", body: { collection: collectionJson(updated) } };
        }),
      );
    } catch (err) {
      if (!collectionsRepo.isHandleConflict(err)) throw err;
      respond(res, HANDLE_TAKEN);
    }
  });

  router.delete("/stores/:storeId/collections/:collectionId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.collectionId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "products.manage", async (trx) => {
        if (!(await collectionsRepo.deleteCollection(trx, req.params.collectionId))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "collection.deleted", resourceType: "collection", resourceId: req.params.collectionId });
        return { kind: "ok", body: { deleted: true } };
      }),
    );
  });
}
