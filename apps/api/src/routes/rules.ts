import type { Router } from "express";
import { auditRepo, rulesRepo, type Discount } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { BookingsQuerySchema, DiscountBodySchema, TaxBodySchema, ZoneBodySchema, ZoneOrderBodySchema } from "../contract/rules.js";
import { problems } from "../http/problem.js";
import { actorOf, invalid, issuesToErrors, respond, UUID_PATTERN, type StoreAccess, type Trx } from "./support.js";

function discountJson(d: Discount, redeemedMinor = 0) {
  return {
    ...d,
    status: rulesRepo.discountStatus(d),
    redeemedMinor,
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Targets must exist in this store: products or collections, as the offer says. */
async function targetsExist(trx: Trx, appliesTo: string, ids: readonly string[]): Promise<boolean> {
  if (appliesTo === "all" || ids.length === 0) return true;
  const table = appliesTo === "products" ? "products" : "collections";
  const found = await trx.selectFrom(table).select("id").where("id", "in", [...new Set(ids)]).execute();
  return found.length === new Set(ids).size;
}

/** Offers, shipping zones and rates, tax settings, and the bookings calendar. */
export function rulesRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  // Offers ------------------------------------------------------------------------------------------

  router.get("/stores/:storeId/discounts", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, ["offers.manage", "analytics.read"], async (trx) => {
        const list = await rulesRepo.listDiscounts(trx);
        const totals = await rulesRepo.redemptionTotals(trx, list.map((d) => d.id));
        return { kind: "ok", body: { items: list.map((d) => discountJson(d, totals.get(d.id) ?? 0)) } };
      }),
    );
  });

  router.get("/stores/:storeId/discounts/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, ["offers.manage", "analytics.read"], async (trx) => {
        const d = await rulesRepo.getDiscount(trx, req.params.id);
        if (!d) return { kind: "not_found" };
        return { kind: "ok", body: { discount: discountJson(d, (await rulesRepo.redemptionTotals(trx, [d.id])).get(d.id) ?? 0) } };
      }),
    );
  });

  const saveDiscount = (id: string | undefined) =>
    async function handler(req: Parameters<Parameters<Router["post"]>[1]>[0], res: Parameters<Parameters<Router["post"]>[1]>[1]) {
      const storeId = String(req.params.storeId);
      if (id !== undefined && !UUID_PATTERN.test(id)) return problems.notFound(res);
      const body = DiscountBodySchema.safeParse(req.body ?? {});
      if (!body.success) return problems.validation(res, issuesToErrors(body.error));
      const b = body.data;
      const offer = b.type === "buy_x_get_y" && b.buyXGetY ? { ...b.buyXGetY, getTargetIds: b.buyXGetY.getAppliesTo === "same" ? [] : [...new Set(b.buyXGetY.getTargetIds)] } : null;
      const input = { ...b, code: b.method === "code" ? b.code : null, startsAt: b.startsAt ? new Date(b.startsAt) : new Date(), endsAt: b.endsAt ? new Date(b.endsAt) : null, targetIds: b.appliesTo === "all" ? [] : [...new Set(b.targetIds)], buyXGetY: offer };
      respond(
        res,
        await withPermission(res, storeId, "offers.manage", async (trx) => {
          if (!(await targetsExist(trx, input.appliesTo, input.targetIds))) return invalid("targetIds", "Some of the chosen items no longer exist");
          if (offer && offer.getAppliesTo !== "same" && !(await targetsExist(trx, offer.getAppliesTo, offer.getTargetIds))) return invalid("buyXGetY.getTargetIds", "Some of the chosen items no longer exist");
          if (input.code) {
            let q = trx.selectFrom("discounts").select("id").where("code", "=", input.code);
            if (id) q = q.where("id", "!=", id);
            if (await q.executeTakeFirst()) return invalid("code", "Another offer already uses this code");
          }
          const saved = id ? await rulesRepo.updateDiscount(trx, id, input) : await rulesRepo.createDiscount(trx, storeId, input);
          if (!saved) return { kind: "not_found" };
          await auditRepo.appendAudit(trx, { storeId, ...actorOf(res), action: id ? "discount.updated" : "discount.created", resourceType: "discount", resourceId: saved.id, metadata: { code: saved.code, type: saved.type } });
          return { kind: "ok", status: id ? 200 : 201, body: { discount: discountJson(saved) } };
        }),
      );
    };

  router.post("/stores/:storeId/discounts", (req, res) => saveDiscount(undefined)(req, res));
  router.put("/stores/:storeId/discounts/:id", (req, res) => saveDiscount(req.params.id)(req, res));

  router.delete("/stores/:storeId/discounts/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "offers.manage", async (trx) => {
        if (!(await rulesRepo.deleteDiscount(trx, req.params.id))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "discount.deleted", resourceType: "discount", resourceId: req.params.id });
        return { kind: "ok", body: {} };
      }),
    );
  });

  // Shipping ----------------------------------------------------------------------------------------

  router.get("/stores/:storeId/shipping/zones", async (req, res) => {
    respond(res, await withPermission(res, req.params.storeId, ["shipping.manage", "orders.read"], async (trx) => ({ kind: "ok", body: { zones: await rulesRepo.listZones(trx) } })));
  });

  router.post("/stores/:storeId/shipping/zones", async (req, res) => {
    const body = ZoneBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "shipping.manage", async (trx) => {
        if ((await rulesRepo.listZones(trx)).length >= 100) return invalid("name", "A store can have up to 100 zones");
        const id = await rulesRepo.createZone(trx, req.params.storeId, body.data);
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "shipping.zone_created", resourceType: "shipping_zone", resourceId: id });
        return { kind: "ok", status: 201, body: { zones: await rulesRepo.listZones(trx), id } };
      }),
    );
  });

  router.put("/stores/:storeId/shipping/zones/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    const body = ZoneBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "shipping.manage", async (trx) => {
        if (!(await rulesRepo.updateZone(trx, req.params.storeId, req.params.id, body.data))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "shipping.zone_updated", resourceType: "shipping_zone", resourceId: req.params.id });
        return { kind: "ok", body: { zones: await rulesRepo.listZones(trx) } };
      }),
    );
  });

  router.delete("/stores/:storeId/shipping/zones/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "shipping.manage", async (trx) => {
        if (!(await rulesRepo.deleteZone(trx, req.params.id))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "shipping.zone_deleted", resourceType: "shipping_zone", resourceId: req.params.id });
        return { kind: "ok", body: { zones: await rulesRepo.listZones(trx) } };
      }),
    );
  });

  router.put("/stores/:storeId/shipping/zone-order", async (req, res) => {
    const body = ZoneOrderBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "shipping.manage", async (trx) => {
        await rulesRepo.reorderZones(trx, body.data.ids);
        return { kind: "ok", body: { zones: await rulesRepo.listZones(trx) } };
      }),
    );
  });

  // Tax ---------------------------------------------------------------------------------------------

  router.get("/stores/:storeId/tax-settings", async (req, res) => {
    respond(res, await withPermission(res, req.params.storeId, ["payments.manage", "finances.read", "products.manage"], async (trx) => ({ kind: "ok", body: { tax: await rulesRepo.getTaxSettings(trx) } })));
  });

  router.put("/stores/:storeId/tax-settings", async (req, res) => {
    const body = TaxBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    respond(
      res,
      await withPermission(res, req.params.storeId, "payments.manage", async (trx) => {
        const tax = await rulesRepo.saveTaxSettings(trx, req.params.storeId, body.data);
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "tax.updated", resourceType: "store", resourceId: req.params.storeId, metadata: { enabled: tax.enabled, defaultRateBps: tax.defaultRateBps, pricesIncludeTax: tax.pricesIncludeTax } });
        return { kind: "ok", body: { tax } };
      }),
    );
  });

  // Bookings ----------------------------------------------------------------------------------------

  router.get("/stores/:storeId/bookings", async (req, res) => {
    const query = BookingsQuerySchema.safeParse(req.query);
    if (!query.success) return problems.validation(res, issuesToErrors(query.error));
    const from = query.data.from ? new Date(query.data.from) : new Date(Date.now() - 2 * 3_600_000);
    respond(
      res,
      await withPermission(res, req.params.storeId, "orders.read", async (trx) => ({
        kind: "ok",
        body: {
          from: from.toISOString(),
          items: (await rulesRepo.listBookings(trx, { from, to: new Date(from.getTime() + query.data.days * 86_400_000), limit: 500 })).map((b) => ({ ...b, at: b.at.toISOString() })),
        },
      })),
    );
  });
}
