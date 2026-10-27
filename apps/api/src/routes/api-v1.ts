import { randomUUID } from "node:crypto";
import { Router } from "express";
import { storePermissions } from "@workeasy/auth";
import { auditRepo, identityRepo, membersRepo, storesRepo, withContext, type StoreRecord } from "@workeasy/database";
import type { AppDependencies } from "../app.js";
import {
  AuditQuerySchema,
  CreateStoreBodySchema,
  StorePatchBodySchema,
  StoreSlug,
  type AuditListResponse,
  type MeResponse,
  type MemberListResponse,
  type SlugAvailabilityResponse,
  type StoreBody,
  type StoreResponse,
} from "../contract/schemas.js";
import { parseCookies } from "../http/cookies.js";
import { problems, sendProblem } from "../http/problem.js";
import { requestIdOf } from "../http/request-context.js";
import { requireSameOrigin } from "../http/same-origin.js";
import { sessionCookieName } from "./auth.js";
import { collectionsRoutes } from "./collections.js";
import { inventoryRoutes } from "./inventory.js";
import { mediaRoutes } from "./media.js";
import { moneyRoutes } from "./money.js";
import { engagementRoutes } from "./engagement.js";
import { studioRoutes } from "./studio.js";
import { teamRoutes } from "./team.js";
import { pagesRoutes } from "./pages.js";
import { rulesRoutes } from "./rules.js";
import { ordersRoutes } from "./orders.js";
import { productsRoutes } from "./products.js";
import { decodeCursor, encodeCursor, issuesToErrors, permissionList, respond, sessionOf, storeAccess, type Outcome } from "./support.js";

/** Stores one user may own; sign-up is open, so this bounds what one account can create. */
const MAX_OWNED_STORES = 10;

function storeBody(store: StoreRecord): StoreBody {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    status: store.status,
    currency: store.currency,
    country: store.country,
    defaultLocale: store.defaultLocale,
    timezone: store.timezone,
    contactEmail: store.contactEmail,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

const SLUG_TAKEN = { kind: "conflict", code: "SLUG_TAKEN", title: "That store address is taken. Choose another" } as const;

export function apiV1Router(deps: AppDependencies): Router {
  const { db, settings } = deps;
  const router = Router();
  const sessionCookie = sessionCookieName(settings.secureCookies);

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.use(async (req, res, next) => {
    const token = parseCookies(req.get("cookie")).get(sessionCookie);
    const session = token ? await identityRepo.resolveSession(db, token) : undefined;
    if (!session) {
      problems.unauthenticated(res);
      return;
    }
    res.locals.session = session;
    next();
  });

  router.use(requireSameOrigin(settings.adminOrigin));

  const access = storeAccess(db);
  const { inStore, withPermission } = access;

  router.get("/me", async (_req, res) => {
    const profile = await identityRepo.getUserProfile(db, sessionOf(res).userId);
    if (!profile) {
      problems.unauthenticated(res);
      return;
    }
    const body: MeResponse = {
      user: { id: profile.id, displayName: profile.displayName },
      stores: profile.memberships.map((m) => ({
        id: m.storeId,
        name: m.storeName,
        slug: m.storeSlug,
        role: m.role,
        permissions: permissionList(m),
      })),
      storefrontOrigin: settings.storefrontOrigin,
    };
    res.json(body);
  });

  /** Whether a store address is free, for live feedback while typing it. */
  router.get("/store-slugs/:slug", async (req, res) => {
    const parsed = StoreSlug.safeParse(req.params.slug);
    if (!parsed.success) {
      const body: SlugAvailabilityResponse = { slug: req.params.slug, available: false, reason: parsed.error.issues[0]?.message ?? "Invalid address" };
      res.json(body);
      return;
    }
    const taken = await storesRepo.isSlugTaken(db, parsed.data);
    const body: SlugAvailabilityResponse = { slug: parsed.data, available: !taken, ...(taken ? { reason: "That address is taken" } : {}) };
    res.json(body);
  });

  router.post("/stores", async (req, res) => {
    const body = CreateStoreBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const userId = sessionOf(res).userId;
    const profile = await identityRepo.getUserProfile(db, userId);
    if (!profile) {
      problems.unauthenticated(res);
      return;
    }
    if (profile.memberships.filter((m) => m.role === "owner").length >= MAX_OWNED_STORES) {
      sendProblem(res, 409, "STORE_LIMIT", `You can own at most ${MAX_OWNED_STORES} stores`);
      return;
    }
    const storeId = randomUUID();
    const input = body.data;
    let store: StoreRecord;
    try {
      store = await withContext(db, { storeId, userId }, async (trx) => {
        const created = await storesRepo.createStore(trx, {
          storeId,
          slug: input.slug,
          name: input.name,
          currency: input.currency,
          country: input.country,
          defaultLocale: input.defaultLocale,
          timezone: input.timezone,
          contactEmail: input.contactEmail ?? null,
          homeRegion: settings.homeRegion ?? "default",
          ownerId: userId,
        });
        await auditRepo.appendAudit(trx, {
          storeId,
          actor: { type: "user", id: userId },
          action: "store.created",
          resourceType: "store",
          resourceId: storeId,
          requestId: requestIdOf(res),
          metadata: { slug: created.slug, currency: created.currency },
        });
        return created;
      });
    } catch (err) {
      if (storesRepo.isSlugCollision(err)) {
        respond(res, SLUG_TAKEN);
        return;
      }
      throw err;
    }
    const response: StoreResponse = { store: storeBody(store), role: "owner", permissions: permissionList({ role: "owner", status: "active" }) };
    res.status(201).location(`/api/v1/stores/${storeId}`).json(response);
  });

  router.get("/stores/:storeId", async (req, res) => {
    respond(
      res,
      await inStore(req.params.storeId, sessionOf(res).userId, async (trx, membership): Promise<Outcome<StoreResponse>> => {
        const store = await storesRepo.getStore(trx);
        if (!store) return { kind: "not_found" };
        return { kind: "ok", body: { store: storeBody(store), role: membership.role, permissions: permissionList(membership) } };
      }),
    );
  });

  /**
   * Changes store settings. The store's address (slug) is its public URL, so
   * changing it needs store.manage (owners); everything else settings.manage.
   */
  router.patch("/stores/:storeId", async (req, res) => {
    const body = StorePatchBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const userId = sessionOf(res).userId;
    const patch = body.data;
    try {
      respond(
        res,
        await withPermission(res, req.params.storeId, "settings.manage", async (trx, membership): Promise<Outcome<StoreResponse>> => {
          if (patch.slug !== undefined && !storePermissions(membership).has("store.manage")) return { kind: "forbidden" };
          const before = await storesRepo.getStore(trx);
          if (!before) return { kind: "not_found" };
          const store = await storesRepo.updateStore(trx, patch);
          if (!store) return { kind: "not_found" };
          await auditRepo.appendAudit(trx, {
            storeId: store.id,
            actor: { type: "user", id: userId },
            action: "store.updated",
            resourceType: "store",
            resourceId: store.id,
            requestId: requestIdOf(res),
            // Field names only: contact details stay out of the audit trail. The address is public, so it is kept.
            metadata: { fields: Object.keys(patch).toSorted(), ...(patch.slug ? { slug: { before: before.slug, after: store.slug } } : {}) },
          });
          return { kind: "ok", body: { store: storeBody(store), role: membership.role, permissions: permissionList(membership) } };
        }),
      );
    } catch (err) {
      if (storesRepo.isSlugCollision(err)) {
        respond(res, SLUG_TAKEN);
        return;
      }
      throw err;
    }
  });

  router.get("/stores/:storeId/members", async (req, res) => {
    respond(
      res,
      await withPermission(res, req.params.storeId, "members.manage", async (trx): Promise<Outcome<MemberListResponse>> => {
        const members = await membersRepo.listMembers(trx);
        return {
          kind: "ok",
          body: {
            members: members.map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role, status: m.status, joinedAt: m.joinedAt.toISOString() })),
          },
        };
      }),
    );
  });

  router.get("/stores/:storeId/audit", async (req, res) => {
    const query = AuditQuerySchema.safeParse(req.query);
    if (!query.success) {
      problems.validation(res, issuesToErrors(query.error));
      return;
    }
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : undefined;
    if (query.data.cursor && (!cursor || Number.isNaN(Date.parse(cursor.at)))) {
      problems.validation(res, [{ field: "cursor", code: "INVALID", message: "Invalid cursor" }]);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, "audit.read", async (trx): Promise<Outcome<AuditListResponse>> => {
        const page = await auditRepo.listAudit(trx, {
          limit: query.data.limit,
          before: cursor ? { occurredAt: cursor.at, id: cursor.id } : undefined,
          action: query.data.action,
        });
        const last = page.entries.at(-1);
        return {
          kind: "ok",
          body: {
            entries: page.entries.map((e) => ({
              id: e.id,
              actor: { type: e.actorType, id: e.actorId, displayName: e.actorName },
              action: e.action,
              resourceType: e.resourceType,
              resourceId: e.resourceId,
              metadata: e.metadata,
              occurredAt: e.occurredAt.toISOString(),
            })),
            ...(page.more && last ? { nextCursor: encodeCursor({ at: last.occurredAtKey, id: last.id }) } : {}),
          },
        };
      }),
    );
  });

  productsRoutes(router, deps, access);
  collectionsRoutes(router, deps, access);
  inventoryRoutes(router, deps, access);
  mediaRoutes(router, deps, access);
  ordersRoutes(router, deps, access);
  moneyRoutes(router, deps, access);
  rulesRoutes(router, deps, access);
  engagementRoutes(router, deps, access);
  studioRoutes(router, deps, access);
  teamRoutes(router, deps, access);
  pagesRoutes(router, deps, access);

  return router;
}
