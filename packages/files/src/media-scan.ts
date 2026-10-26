import { Readable } from "node:stream";
import { mediaRepo, type Db } from "@workeasy/database";
import { PermanentJobError, type JobDefinition } from "@workeasy/jobs";
import { detectType, imageSize, MEDIA_RULES, SNIFF_BYTES } from "./detect.js";
import { scanStream, ScannerUnavailableError, type ScannerConfig } from "./scanner.js";
import type { ObjectStore } from "./storage.js";

/**
 * The media.scan job: checks one upload the browser has finished sending.
 * In order: the object exists at the declared size, its bytes are a type the
 * asset's kind allows, and the malware scanner finds nothing. Clean files
 * move to the media bucket and become ready; anything else is deleted and
 * the asset is marked rejected with a reason. An unreachable scanner retries
 * the job: nothing is ever passed unscanned.
 */
export const MEDIA_SCAN_JOB = "media.scan";

export interface MediaScanDeps {
  workerDb: Db;
  store: ObjectStore;
  scanner: ScannerConfig;
  log?: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
}

async function readAll(body: Readable, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += (chunk as Buffer).length;
    if (total > limit) {
      body.destroy();
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function mediaScanJob(deps: MediaScanDeps): JobDefinition {
  return {
    // Scanning 25 MiB can take a while on a busy scanner.
    leaseSeconds: 180,
    async handle(ctx) {
      const mediaId = typeof ctx.payload.mediaId === "string" ? ctx.payload.mediaId : undefined;
      if (!mediaId) throw new PermanentJobError("bad_payload");
      const target = await mediaRepo.getScanTarget(deps.workerDb, ctx.storeId, mediaId);
      // Deleted meanwhile, or already decided by an earlier attempt.
      if (!target || target.status !== "scanning") return;

      const { store } = deps;
      const rules = MEDIA_RULES[target.kind];
      const reject = async (reason: string) => {
        await store.remove(store.quarantineBucket, target.storageKey);
        await mediaRepo.finishScan(deps.workerDb, target, { outcome: "rejected", reason });
        deps.log?.("info", "media upload rejected", { mediaId, reason });
      };

      const info = await store.head(store.quarantineBucket, target.storageKey);
      if (!info) return reject("missing");
      if (info.bytes !== target.byteSize) return reject("size_mismatch");
      if (info.bytes > rules.maxBytes) return reject("too_large");

      const bytes = await readAll(await store.read(store.quarantineBucket, target.storageKey), rules.maxBytes);
      if (!bytes) return reject("too_large");
      const head = bytes.subarray(0, SNIFF_BYTES);
      // The content decides the type, never the name or the declared header.
      const detected = detectType(head);
      if (!rules.types.includes(detected)) return reject("type_not_allowed");

      let verdict;
      try {
        verdict = await scanStream(deps.scanner, Readable.from([bytes]));
      } catch (err) {
        if (err instanceof ScannerUnavailableError) deps.log?.("warn", "scanner unavailable; media scan will retry", { mediaId, attempt: ctx.attempt });
        throw err;
      }
      if (verdict.status === "infected") {
        // Operators see the signature; the merchant only learns the file was blocked.
        deps.log?.("warn", "media upload blocked by malware scan", { mediaId, signature: verdict.signature });
        return reject("infected");
      }
      await store.promote(target.storageKey);
      const size = target.kind === "image" ? imageSize(head, detected) : undefined;
      await mediaRepo.finishScan(deps.workerDb, target, { outcome: "ready", contentType: detected, width: size?.width ?? null, height: size?.height ?? null });
    },
  };
}
