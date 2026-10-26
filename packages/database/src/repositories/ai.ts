import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import type { AiGenerationsTable, Database } from "../schema.js";
import { enqueueJob } from "./jobs.js";

/**
 * AI Studio generations: queued by the API, worked by the worker, applied
 * or discarded by the merchant. Each store has a daily allowance.
 */
type Trx = Transaction<Database>;

export const AI_GENERATE_JOB = "ai.generate";

export interface Generation {
  id: string;
  task: AiGenerationsTable["task"];
  targetType: "product" | "collection" | null;
  targetId: string | null;
  input: Record<string, unknown>;
  status: "queued" | "running" | "succeeded" | "failed";
  output: Record<string, unknown> | null;
  errorCode: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  finishedAt: Date | null;
  appliedAt: Date | null;
  discardedAt: Date | null;
}

function toGeneration(r: Selectable<AiGenerationsTable>): Generation {
  return {
    id: r.id,
    task: r.task,
    targetType: r.target_type,
    targetId: r.target_id,
    input: r.input,
    status: r.status,
    output: r.output,
    errorCode: r.error_code,
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    appliedAt: r.applied_at,
    discardedAt: r.discarded_at,
  };
}

/** Generations used today (UTC day). */
export async function usedToday(trx: Trx): Promise<number> {
  const r = await trx.selectFrom("ai_usage_days").select("generations").where("day", "=", sql<string>`current_date`).executeTakeFirst();
  return r?.generations ?? 0;
}

/**
 * Queues a generation if today's allowance has room: the usage row is
 * locked and counted in the same transaction, so parallel requests can't
 * go over.
 */
export async function requestGeneration(
  trx: Trx,
  input: { storeId: string; task: Generation["task"]; targetType: "product" | "collection" | null; targetId: string | null; input: Record<string, unknown>; userId: string; dailyLimit: number; traceId?: string | undefined },
): Promise<{ kind: "queued"; generation: Generation } | { kind: "limit"; limit: number }> {
  await trx
    .insertInto("ai_usage_days")
    .values({ store_id: input.storeId, day: sql<string>`current_date` })
    .onConflict((oc) => oc.columns(["store_id", "day"]).doNothing())
    .execute();
  const usage = await trx.selectFrom("ai_usage_days").select("generations").where("day", "=", sql<string>`current_date`).forUpdate().executeTakeFirstOrThrow();
  if (usage.generations >= input.dailyLimit) return { kind: "limit", limit: input.dailyLimit };
  await trx.updateTable("ai_usage_days").set((eb) => ({ generations: eb("generations", "+", 1) })).where("day", "=", sql<string>`current_date`).execute();
  const row = await trx
    .insertInto("ai_generations")
    .values({ store_id: input.storeId, task: input.task, target_type: input.targetType, target_id: input.targetId, input: input.input, created_by: input.userId })
    .returningAll()
    .executeTakeFirstOrThrow();
  await enqueueJob(trx, { storeId: input.storeId, type: AI_GENERATE_JOB, dedupeKey: `ai:${row.id}`, payload: { generationId: row.id, requestId: randomUUID() }, traceId: input.traceId, maxAttempts: 4 });
  return { kind: "queued", generation: toGeneration(row) };
}

export async function getGeneration(trx: Trx, id: string): Promise<Generation | undefined> {
  const r = await trx.selectFrom("ai_generations").selectAll().where("id", "=", id).executeTakeFirst();
  return r ? toGeneration(r) : undefined;
}

export async function listGenerations(trx: Trx, opts: { targetId?: string | undefined; limit: number }): Promise<Generation[]> {
  let q = trx.selectFrom("ai_generations").selectAll().orderBy("created_at", "desc").limit(opts.limit);
  if (opts.targetId) q = q.where("target_id", "=", opts.targetId);
  return (await q.execute()).map(toGeneration);
}

// Worker side ------------------------------------------------------------------------------------

export async function markRunning(trx: Trx, id: string): Promise<Generation | undefined> {
  const r = await trx.updateTable("ai_generations").set({ status: "running" }).where("id", "=", id).where("status", "in", ["queued", "running"]).returningAll().executeTakeFirst();
  return r ? toGeneration(r) : undefined;
}

export async function finish(
  trx: Trx,
  id: string,
  result: { ok: true; output: Record<string, unknown> } | { ok: false; code: string },
  meta: { provider: string; model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  await trx
    .updateTable("ai_generations")
    .set({
      status: result.ok ? "succeeded" : "failed",
      output: result.ok ? result.output : null,
      error_code: result.ok ? null : result.code,
      provider: meta.provider,
      model: meta.model,
      input_tokens: meta.inputTokens,
      output_tokens: meta.outputTokens,
      finished_at: sql<Date>`now()`,
    })
    .where("id", "=", id)
    .execute();
  await trx
    .updateTable("ai_usage_days")
    .set((eb) => ({ tokens: eb("tokens", "+", meta.inputTokens + meta.outputTokens) }))
    .where("day", "=", sql<string>`current_date`)
    .execute();
}

// Applying ---------------------------------------------------------------------------------------

export async function markApplied(trx: Trx, id: string, userId: string): Promise<boolean> {
  const r = await trx
    .updateTable("ai_generations")
    .set({ applied_at: sql<Date>`now()`, applied_by: userId })
    .where("id", "=", id)
    .where("status", "=", "succeeded")
    .where("applied_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  return r !== undefined;
}

export async function markDiscarded(trx: Trx, id: string): Promise<boolean> {
  const r = await trx.updateTable("ai_generations").set({ discarded_at: sql<Date>`now()` }).where("id", "=", id).where("applied_at", "is", null).returning("id").executeTakeFirst();
  return r !== undefined;
}
