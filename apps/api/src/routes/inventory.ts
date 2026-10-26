import type { Router } from "express";
import { auditRepo, inventoryRepo } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { AdjustStockBodySchema, InventoryQuerySchema, ThresholdBodySchema } from "../contract/catalog.js";
import { problems } from "../http/problem.js";
import { actorOf, decodeCursor, encodeCursor, invalid, issuesToErrors, respond, UUID_PATTERN, type StoreAccess } from "./support.js";

/** Cursor for the inventory list: product title, variant position and id. */
function inventoryCursor(value: string | undefined): { title: string; position: number; id: string } | undefined | null {
  if (!value) return undefined;
  const c = decodeCursor(value);
  if (!c) return null;
  const split = c.at.lastIndexOf("\u0000");
  const position = Number(c.at.slice(split + 1));
  if (split < 0 || !Number.isInteger(position)) return null;
  return { title: c.at.slice(0, split), position, id: c.id };
}

export function inventoryRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  router.get("/stores/:storeId/inventory", async (req, res) => {
    const query = InventoryQuerySchema.safeParse(req.query);
    const after = query.success ? inventoryCursor(query.data.cursor) : undefined;
    if (!query.success || after === null) {
      problems.validation(res, query.success ? [{ field: "cursor", code: "INVALID", message: "Invalid cursor" }] : issuesToErrors(query.error));
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "inventory.read", async (trx) => {
        const page = await inventoryRepo.listInventory(trx, { q: query.data.q, filter: query.data.filter, limit: query.data.limit, after });
        const last = page.rows.at(-1);
        return {
          kind: "ok",
          body: {
            items: page.rows.map(({ position: _p, ...r }) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
            summary: await inventoryRepo.stockSummary(trx),
            ...(page.more && last ? { nextCursor: encodeCursor({ at: `${last.productTitle}\u0000${last.position}`, id: last.variantId }) } : {}),
          },
        };
      }),
    );
  });

  /** Adds to or sets a variant's stock, recording the reason in the ledger. */
  router.post("/stores/:storeId/inventory/:variantId/adjust", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.variantId)) {
      problems.notFound(res);
      return;
    }
    const body = AdjustStockBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const { mode, quantity, reason, note } = body.data;
    respond(
      res,
      await withPermission(res, req.params.storeId, "inventory.manage", async (trx, _m, userId) => {
        const before = await inventoryRepo.getLevel(trx, req.params.variantId);
        if (!before) return { kind: "not_found" };
        if (mode === "add" && quantity === 0) return invalid("quantity", "Enter how many to add or remove");
        const input = { storeId: req.params.storeId, variantId: req.params.variantId, reason, note, actorId: userId };
        const onHand = mode === "add" ? await inventoryRepo.recordMovement(trx, { ...input, delta: quantity }) : await inventoryRepo.setOnHand(trx, { ...input, target: quantity });
        await auditRepo.appendAudit(trx, {
          storeId: req.params.storeId,
          ...actorOf(res),
          action: "inventory.adjusted",
          resourceType: "variant",
          resourceId: req.params.variantId,
          metadata: { reason, before: before.onHand, after: onHand },
        });
        return { kind: "ok", body: { onHand, reserved: before.reserved, available: (onHand ?? 0) - before.reserved } };
      }),
    );
  });

  router.put("/stores/:storeId/inventory/:variantId/threshold", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.variantId)) {
      problems.notFound(res);
      return;
    }
    const body = ThresholdBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "inventory.manage", async (trx) => {
        if (!(await inventoryRepo.setThreshold(trx, req.params.variantId, body.data.lowStockThreshold))) return { kind: "not_found" };
        return { kind: "ok", body: { lowStockThreshold: body.data.lowStockThreshold } };
      }),
    );
  });

  router.get("/stores/:storeId/inventory/:variantId/movements", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.variantId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "inventory.read", async (trx) => {
        if (!(await inventoryRepo.getLevel(trx, req.params.variantId))) return { kind: "not_found" };
        const movements = await inventoryRepo.listMovements(trx, req.params.variantId, 100);
        return { kind: "ok", body: { movements: movements.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) } };
      }),
    );
  });
}
