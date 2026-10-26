import { createHmac, timingSafeEqual } from "node:crypto";
import type { Router } from "express";
import { themeProblems, type Theme } from "@workeasy/commerce";
import { aiRepo, auditRepo, designRepo, mediaRepo, productsRepo, reviewsRepo, storesRepo, type Generation } from "@workeasy/database";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { problems, sendProblem } from "../http/problem.js";
import { requestIdOf } from "../http/request-context.js";
import { analyticsReport } from "./engagement.js";
import { actorOf, invalid, issuesToErrors, respond, UUID_PATTERN, type StoreAccess, type Trx } from "./support.js";

/** How long a Store Design preview link works. */
const PREVIEW_SECONDS = 2 * 60 * 60;

const GenerationBodySchema = z.object({
  task: z.enum(["product_copy", "collection_copy", "review_summary", "sales_insights"]),
  targetId: z.uuid().nullable().optional(),
  tone: z.enum(["friendly", "premium", "playful", "minimal"]).default("friendly"),
  language: z.enum(["en", "hi", "ar", "ta", "te", "bn", "mr", "gu", "kn", "ml", "es", "fr", "de"]).default("en"),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

const ApplyBodySchema = z.object({
  /** Which parts of a copy proposal to use. */
  fields: z.array(z.enum(["description", "seo", "tags"])).min(1).default(["description", "seo"]),
});

function generationJson(g: Generation) {
  return { ...g, createdAt: g.createdAt.toISOString(), finishedAt: g.finishedAt?.toISOString() ?? null, appliedAt: g.appliedAt?.toISOString() ?? null, discardedAt: g.discardedAt?.toISOString() ?? null };
}

/** A signed, expiring token that lets the storefront show a store's draft theme. */
export function previewToken(secret: string, storeId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + PREVIEW_SECONDS;
  const sig = createHmac("sha256", secret).update(`theme-preview:${storeId}:${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyPreviewToken(secret: string, storeId: string, token: string, now = Date.now()): boolean {
  const [expText, sig] = token.split(".");
  const exp = Number(expText);
  if (!sig || !Number.isInteger(exp) || exp < now / 1000) return false;
  const expected = createHmac("sha256", secret).update(`theme-preview:${storeId}:${exp}`).digest();
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What the model works from, gathered from the store for each task. Nothing private goes in. */
async function taskData(trx: Trx, storeId: string, task: Generation["task"], targetId: string | null): Promise<{ data: Record<string, unknown>; targetType: "product" | "collection" | null } | undefined> {
  if (task === "product_copy" || task === "review_summary") {
    if (!targetId) return undefined;
    const p = await productsRepo.getProduct(trx, targetId);
    if (!p) return undefined;
    const base = { title: p.title, type: p.type, vendor: p.vendor, tags: p.tags, options: p.options, currentDescription: p.description.slice(0, 3000), prices: [...new Set(p.variants.map((v) => v.priceMinor))].slice(0, 5) };
    if (task === "product_copy") return { data: base, targetType: "product" };
    const reviews = await reviewsRepo.publishedReviews(trx, p.id, 60, 0);
    return { data: { title: p.title, reviews: reviews.map((r) => ({ rating: r.rating, text: [r.title, r.body].filter(Boolean).join(". ").slice(0, 600) })) }, targetType: "product" };
  }
  if (task === "collection_copy") {
    if (!targetId) return undefined;
    const c = await trx.selectFrom("collections").select(["id", "title", "description"]).where("id", "=", targetId).executeTakeFirst();
    if (!c) return undefined;
    const products = await trx.selectFrom("collection_products as cp").innerJoin("products as p", "p.id", "cp.product_id").select("p.title").where("cp.collection_id", "=", c.id).limit(20).execute();
    return { data: { title: c.title, currentDescription: c.description.slice(0, 2000), products: products.map((x) => x.title) }, targetType: "collection" };
  }
  const r = await analyticsReport(trx, storeId, 30);
  return {
    data: { period: `${r.from} to ${r.to}`, currency: r.currency, totals: r.totals, previousPeriod: r.previous, funnel: r.funnel, sources: r.sources.slice(0, 6), topProducts: r.topProducts.slice(0, 6), customers: r.customers },
    targetType: null,
  };
}

/** AI Studio requests and proposals, and the Store Design draft, publish and preview. */
export function studioRoutes(router: Router, { settings }: AppDependencies, { withPermission }: StoreAccess): void {
  const dailyLimit = settings.aiDailyLimit ?? 100;

  // AI Studio -------------------------------------------------------------------------------------

  router.get("/stores/:storeId/ai/generations", async (req, res) => {
    const targetId = typeof req.query.targetId === "string" && UUID_PATTERN.test(req.query.targetId) ? req.query.targetId : undefined;
    respond(
      res,
      await withPermission(res, req.params.storeId, "ai.use", async (trx) => ({
        kind: "ok",
        body: { items: (await aiRepo.listGenerations(trx, { targetId, limit: 50 })).map(generationJson), usedToday: await aiRepo.usedToday(trx), dailyLimit, provider: settings.aiProvider ?? "disabled" },
      })),
    );
  });

  router.get("/stores/:storeId/ai/generations/:id", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "ai.use", async (trx) => {
        const g = await aiRepo.getGeneration(trx, req.params.id);
        return g ? { kind: "ok", body: { generation: generationJson(g) } } : { kind: "not_found" };
      }),
    );
  });

  router.post("/stores/:storeId/ai/generations", async (req, res) => {
    const body = GenerationBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    if ((settings.aiProvider ?? "disabled") === "disabled") return sendProblem(res, 503, "AI_DISABLED", "AI Studio isn't set up on this server");
    const b = body.data;
    const out = await withPermission(res, req.params.storeId, "ai.use", async (trx, _m, userId) => {
      const store = (await storesRepo.getStore(trx))!;
      const found = await taskData(trx, req.params.storeId, b.task, b.targetId ?? null);
      if (!found) return invalid("targetId", b.task === "collection_copy" ? "Choose a collection" : b.task === "sales_insights" ? "Nothing to analyse" : "Choose a product");
      if (b.task === "review_summary" && (found.data.reviews as unknown[]).length === 0) return invalid("targetId", "This product has no published reviews to summarise yet");
      const r = await aiRepo.requestGeneration(trx, {
        storeId: req.params.storeId,
        task: b.task,
        targetType: found.targetType,
        targetId: found.targetType ? (b.targetId ?? null) : null,
        input: { storeName: store.name, language: b.language, tone: b.tone, notes: b.notes, data: found.data },
        userId,
        dailyLimit,
        traceId: requestIdOf(res),
      });
      if (r.kind === "limit") return { kind: "conflict", code: "AI_DAILY_LIMIT", title: `You've used today's ${r.limit} AI generations. More are available tomorrow` };
      return { kind: "ok", status: 202, body: { generation: generationJson(r.generation) } };
    });
    respond(res, out);
  });

  /** Uses a proposal: writes the chosen parts into the product or collection. */
  router.post("/stores/:storeId/ai/generations/:id/apply", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    const body = ApplyBodySchema.safeParse(req.body ?? {});
    if (!body.success) return problems.validation(res, issuesToErrors(body.error));
    const fields = new Set(body.data.fields);
    respond(
      res,
      await withPermission(res, req.params.storeId, ["products.manage"], async (trx, membership, userId) => {
        void membership;
        const g = await aiRepo.getGeneration(trx, req.params.id);
        if (!g) return { kind: "not_found" };
        if (g.status !== "succeeded" || !g.output || !g.targetId || g.appliedAt) return { kind: "conflict", code: "NOT_APPLICABLE", title: g.appliedAt ? "This proposal is already applied" : "Only finished product or collection copy can be applied" };
        const o = g.output as { description?: string; seoTitle?: string; seoDescription?: string; tags?: string[] };
        const table = g.targetType === "collection" ? "collections" : "products";
        const set: Record<string, unknown> = {};
        if (fields.has("description") && o.description) set.description = o.description;
        if (fields.has("seo") && o.seoTitle) Object.assign(set, { seo_title: o.seoTitle.slice(0, 120), seo_description: (o.seoDescription ?? "").slice(0, 320) || null });
        if (fields.has("tags") && table === "products" && o.tags) {
          const current = await trx.selectFrom("products").select("tags").where("id", "=", g.targetId).executeTakeFirst();
          set.tags = [...new Set([...(current?.tags ?? []), ...o.tags])].slice(0, 30);
        }
        if (Object.keys(set).length === 0) return invalid("fields", "Nothing to apply");
        const updated = await trx.updateTable(table).set(set).where("id", "=", g.targetId).returning("id").executeTakeFirst();
        if (!updated) return { kind: "not_found" };
        await aiRepo.markApplied(trx, g.id, userId);
        await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "ai.applied", resourceType: table === "products" ? "product" : "collection", resourceId: g.targetId, metadata: { generationId: g.id, fields: [...fields] } });
        return { kind: "ok", body: { generation: generationJson((await aiRepo.getGeneration(trx, g.id))!) } };
      }),
    );
  });

  router.post("/stores/:storeId/ai/generations/:id/discard", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return problems.notFound(res);
    respond(
      res,
      await withPermission(res, req.params.storeId, "ai.use", async (trx) => {
        if (!(await aiRepo.markDiscarded(trx, req.params.id))) return { kind: "not_found" };
        return { kind: "ok", body: { generation: generationJson((await aiRepo.getGeneration(trx, req.params.id))!) } };
      }),
    );
  });

  // Store Design ----------------------------------------------------------------------------------

  const stateJson = (s: designRepo.ThemeState, storeId: string) => ({
    draft: s.draft,
    published: s.published,
    publishedAt: s.publishedAt?.toISOString() ?? null,
    updatedAt: s.updatedAt?.toISOString() ?? null,
    unpublished: s.unpublished,
    previewToken: previewToken(settings.sessionSecret, storeId),
  });

  router.get("/stores/:storeId/design", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, "design.manage", async (trx) => {
        const store = (await storesRepo.getStore(trx))!;
        return { kind: "ok", body: stateJson(await designRepo.getThemeState(trx, store.defaultLocale), req.params.storeId) };
      }),
    );
  });

  router.put("/stores/:storeId/design/draft", async (req, res) => {
    const theme = (req.body ?? {}).theme as unknown;
    const found = themeProblems(theme);
    if (found.length > 0) return problems.validation(res, found.slice(0, 20).map((m) => ({ field: m.split(":")[0]!, code: "INVALID", message: m.split(": ").slice(1).join(": ") || m })));
    const t = theme as Theme;
    respond(
      res,
      await withPermission(res, req.params.storeId, "design.manage", async (trx, _m, userId) => {
        const imageIds = [t.logoMediaId, ...t.sections.map((s) => ("imageId" in s ? s.imageId : null))].filter((x): x is string => x !== null);
        const ready = await mediaRepo.readyIds(trx, [...new Set(imageIds)], ["image"]);
        if (ready.length !== new Set(imageIds).size) return invalid("sections", "Some images aren't ready yet or no longer exist");
        await designRepo.saveDraft(trx, req.params.storeId, t, userId);
        const store = (await storesRepo.getStore(trx))!;
        return { kind: "ok", body: stateJson(await designRepo.getThemeState(trx, store.defaultLocale), req.params.storeId) };
      }),
    );
  });

  for (const action of ["publish", "discard"] as const) {
    router.post(`/stores/:storeId/design/${action}`, async (req, res) => {
      respond(
        res,
        await withPermission(res, req.params.storeId, "design.manage", async (trx, _m, userId) => {
          const store = (await storesRepo.getStore(trx))!;
          if (action === "publish") await designRepo.publish(trx, req.params.storeId, userId, store.defaultLocale);
          else await designRepo.discardDraft(trx, store.defaultLocale);
          await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: action === "publish" ? "design.published" : "design.draft_discarded", resourceType: "store", resourceId: req.params.storeId });
          return { kind: "ok", body: stateJson(await designRepo.getThemeState(trx, store.defaultLocale), req.params.storeId) };
        }),
      );
    });
  }
}
