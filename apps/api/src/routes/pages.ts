import type { Router } from "express";
import { auditRepo, pagesRepo, type StorePage } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import { PageBodySchema } from "../contract/pages.js";
import { problems } from "../http/problem.js";
import { actorOf, invalid, issuesToErrors, respond, UUID_PATTERN, type StoreAccess } from "./support.js";

function pageJson(p: StorePage) {
  return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

/** Content pages: About us, policies, contact. Part of Store Design. */
export function pagesRoutes(router: Router, _deps: AppDependencies, { withPermission }: StoreAccess): void {
  router.get("/stores/:storeId/pages", async (req, res) => {
    respond(res, await withPermission(res, req.params.storeId, "design.manage", async (trx) => ({ kind: "ok", body: { items: (await pagesRepo.listPages(trx)).map(pageJson) } })));
  });

  router.get("/stores/:storeId/pages/:pageId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.pageId)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "design.manage", async (trx) => {
        const page = await pagesRepo.getPage(trx, req.params.pageId);
        return page ? { kind: "ok", body: { page: pageJson(page) } } : { kind: "not_found" };
      }),
    );
  });

  const save = (pageId: string | undefined) =>
    async function handler(req: Parameters<Parameters<Router["post"]>[1]>[0], res: Parameters<Parameters<Router["post"]>[1]>[1]) {
      const storeId = String(req.params.storeId);
      if (pageId !== undefined && !UUID_PATTERN.test(pageId)) return problems.notFound(res);
      const body = PageBodySchema.safeParse(req.body ?? {});
      if (!body.success) return problems.validation(res, issuesToErrors(body.error));
      const input = body.data;
      if (!input.handle) return problems.validation(res, [{ field: "handle", code: "INVALID", message: "Give the page an address" }]);
      respond(
        res,
        await withPermission(res, storeId, "design.manage", async (trx) => {
          const before = pageId ? await pagesRepo.getPage(trx, pageId) : undefined;
          if (pageId && !before) return { kind: "not_found" };
          if (!pageId && (await pagesRepo.countPages(trx)) >= pagesRepo.MAX_PAGES) return invalid("title", `A store can have up to ${pagesRepo.MAX_PAGES} pages`);
          if (await pagesRepo.handleTaken(trx, input.handle, pageId)) return invalid("handle", "Another page already uses this address");
          const saved = pageId ? (await pagesRepo.updatePage(trx, pageId, input))! : await pagesRepo.createPage(trx, storeId, input);
          const action = !before ? "page.created" : before.published !== saved.published ? (saved.published ? "page.published" : "page.unpublished") : "page.updated";
          await auditRepo.appendAudit(trx, { storeId, ...actorOf(res), action, resourceType: "page", resourceId: saved.id, metadata: { handle: saved.handle } });
          return { kind: "ok", status: pageId ? 200 : 201, body: { page: pageJson(saved) } };
        }),
      );
    };

  router.post("/stores/:storeId/pages", (req, res) => save(undefined)(req, res));
  router.put("/stores/:storeId/pages/:pageId", (req, res) => save(req.params.pageId)(req, res));

  router.delete("/stores/:storeId/pages/:pageId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.pageId)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "design.manage", async (trx) => {
        if (!(await pagesRepo.deletePage(trx, req.params.pageId))) return { kind: "not_found" };
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "page.deleted", resourceType: "page", resourceId: req.params.pageId });
        return { kind: "ok", body: {} };
      }),
    );
  });
}
