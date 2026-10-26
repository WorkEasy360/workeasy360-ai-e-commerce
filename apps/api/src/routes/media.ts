import { randomUUID } from "node:crypto";
import type { Router } from "express";
import { auditRepo, jobsRepo, mediaRepo, type MediaAsset } from "@workeasy/database";
import { kindForDeclaredType, MEDIA_RULES, MEDIA_SCAN_JOB, safeFileName, type MediaKind } from "@workeasy/files";
import type { AppDependencies } from "../app.js";
import { MediaListQuerySchema, MediaPatchBodySchema, MediaUploadBodySchema } from "../contract/catalog.js";
import { problems } from "../http/problem.js";
import { requestLog } from "../http/request-context.js";
import { actorOf, decodeCursor, encodeCursor, invalid, issuesToErrors, respond, UUID_PATTERN, type StoreAccess } from "./support.js";

/** How long a browser has to finish sending an upload. */
const UPLOAD_URL_SECONDS = 15 * 60;
/** How long a signed download link for a private file works. */
const DOWNLOAD_URL_SECONDS = 5 * 60;

function mediaJson(m: MediaAsset & { usage?: number }) {
  return { ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() };
}

const MB = 1024 * 1024;

/**
 * The Media Library. Uploads go straight from the browser to quarantine
 * storage with a presigned PUT; "complete" queues the scan job, and the asset
 * becomes ready (or rejected) when the worker has checked it. Anyone who edits
 * products may upload; deleting needs media.manage.
 */
export function mediaRoutes(router: Router, { objectStore, logger }: AppDependencies, { withPermission }: StoreAccess): void {
  const canUse = ["media.manage", "products.manage"] as const;

  router.get("/stores/:storeId/media", async (req, res) => {
    const query = MediaListQuerySchema.safeParse(req.query);
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
      await withPermission(res, req.params.storeId, canUse, async (trx) => {
        const page = await mediaRepo.listMedia(trx, {
          q: query.data.q,
          kind: query.data.kind,
          readyOnly: query.data.ready,
          limit: query.data.limit,
          after: cursor ? { createdAt: cursor.at, id: cursor.id } : undefined,
        });
        const last = page.items.at(-1);
        return {
          kind: "ok",
          body: {
            items: page.items.map(({ createdAtKey: _key, ...m }) => mediaJson(m)),
            ...(page.more && last ? { nextCursor: encodeCursor({ at: last.createdAtKey, id: last.id }) } : {}),
          },
        };
      }),
    );
  });

  router.post("/stores/:storeId/media/uploads", async (req, res) => {
    const body = MediaUploadBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const { filename, contentType, byteSize, purpose, folder } = body.data;
    const kind: MediaKind | undefined = purpose === "file" ? "file" : kindForDeclaredType(contentType);
    if (!kind || !MEDIA_RULES[kind].types.includes(contentType)) {
      respond(res, invalid("contentType", purpose === "file" ? "This file type can't be sold as a download" : "Upload a JPEG, PNG, GIF or WebP image, or an MP4 or WebM video"));
      return;
    }
    if (byteSize > MEDIA_RULES[kind].maxBytes) {
      respond(res, invalid("byteSize", `Files of this kind can be at most ${Math.floor(MEDIA_RULES[kind].maxBytes / MB)} MB`));
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, canUse, async (trx, _m, userId) => {
        // The key is random and never contains the file's name.
        const storageKey = `${req.params.storeId}/${randomUUID()}`;
        const asset = await mediaRepo.createUpload(trx, {
          storeId: req.params.storeId,
          kind,
          visibility: kind === "file" ? "private" : "public",
          filename: safeFileName(filename),
          declaredType: contentType,
          byteSize,
          storageKey,
          folder,
          createdBy: userId,
        });
        const uploadUrl = await objectStore.presignUpload(storageKey, contentType, byteSize, UPLOAD_URL_SECONDS);
        return { kind: "ok", status: 201, body: { media: mediaJson(asset), upload: { url: uploadUrl, method: "PUT", headers: { "Content-Type": contentType } } } };
      }),
    );
  });

  /** The browser finished sending the file: queue the scan. */
  router.post("/stores/:storeId/media/:mediaId/complete", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.mediaId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, canUse, async (trx) => {
        const scanning = await mediaRepo.markScanning(trx, req.params.mediaId);
        if (!scanning) {
          const current = await mediaRepo.getMedia(trx, req.params.mediaId);
          // Completing twice is harmless: report where it is.
          return current ? { kind: "ok", body: { media: mediaJson(current) } } : { kind: "not_found" };
        }
        await jobsRepo.enqueueJob(trx, { storeId: req.params.storeId, type: MEDIA_SCAN_JOB, dedupeKey: scanning.id, payload: { mediaId: scanning.id }, maxAttempts: 10 });
        await auditRepo.appendAudit(trx, {
          storeId: req.params.storeId,
          ...actorOf(res),
          action: "media.uploaded",
          resourceType: "media",
          resourceId: scanning.id,
          metadata: { kind: scanning.kind, bytes: scanning.byteSize },
        });
        return { kind: "ok", body: { media: mediaJson(scanning) } };
      }),
    );
  });

  router.get("/stores/:storeId/media/:mediaId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.mediaId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, canUse, async (trx) => {
        const media = await mediaRepo.getMedia(trx, req.params.mediaId);
        if (!media) return { kind: "not_found" };
        return { kind: "ok", body: { media: mediaJson(media), usage: await mediaRepo.mediaUsage(trx, media.id) } };
      }),
    );
  });

  router.patch("/stores/:storeId/media/:mediaId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.mediaId)) {
      problems.notFound(res);
      return;
    }
    const body = MediaPatchBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      problems.validation(res, issuesToErrors(body.error));
      return;
    }
    const patch = { ...body.data, ...(body.data.filename ? { filename: safeFileName(body.data.filename) } : {}) };
    respond(
      res,
      await withPermission(res, req.params.storeId, canUse, async (trx) => {
        const media = await mediaRepo.updateMedia(trx, req.params.mediaId, patch);
        return media ? { kind: "ok", body: { media: mediaJson(media) } } : { kind: "not_found" };
      }),
    );
  });

  /** A short-lived link to download a private file (a digital product's deliverable). */
  router.get("/stores/:storeId/media/:mediaId/download", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.mediaId)) {
      problems.notFound(res);
      return;
    }
    respond(
      res,
      await withPermission(res, req.params.storeId, canUse, async (trx) => {
        const media = await mediaRepo.getMedia(trx, req.params.mediaId);
        if (!media || media.status !== "ready") return { kind: "not_found" };
        const key = (await mediaRepo.storageKeyOf(trx, media.id))!;
        const url = await objectStore.presignDownload(key, media.filename, media.contentType ?? "application/octet-stream", DOWNLOAD_URL_SECONDS);
        return { kind: "ok", body: { url, expiresInSeconds: DOWNLOAD_URL_SECONDS } };
      }),
    );
  });

  router.delete("/stores/:storeId/media/:mediaId", async (req, res) => {
    if (!UUID_PATTERN.test(req.params.mediaId)) {
      problems.notFound(res);
      return;
    }
    let removed: { storageKey: string; status: string } | undefined;
    try {
      respond(
        res,
        await withPermission(res, req.params.storeId, "media.manage", async (trx) => {
          removed = await mediaRepo.deleteMedia(trx, req.params.mediaId);
          if (!removed) return { kind: "not_found" };
          await auditRepo.appendAudit(trx, { storeId: req.params.storeId, ...actorOf(res), action: "media.deleted", resourceType: "media", resourceId: req.params.mediaId });
          return { kind: "ok", body: { deleted: true } };
        }),
      );
    } catch (err) {
      // ON DELETE RESTRICT reports restrict_violation (23001); a plain foreign key, 23503.
      const code = (err as { code?: string }).code;
      if (code !== "23001" && code !== "23503") throw err;
      respond(res, { kind: "conflict", code: "MEDIA_IN_USE", title: "A digital product delivers this file. Remove it from the product first" });
      return;
    }
    // The row is gone; remove the object too. A failure leaves an orphan object, never a broken asset.
    if (removed) {
      const bucket = removed.status === "ready" ? objectStore.mediaBucket : objectStore.quarantineBucket;
      await objectStore.remove(bucket, removed.storageKey).catch((err: unknown) => requestLog(res, logger).warn({ err }, "could not delete a media object"));
    }
  });
}
