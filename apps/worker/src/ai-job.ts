import { runTask, type AiTask, type JsonCompletionProvider, type TaskInput, type Tone } from "@workeasy/ai";
import { aiRepo, withStore, type Db } from "@workeasy/database";
import { PermanentJobError, type JobDefinition } from "@workeasy/jobs";

/**
 * The ai.generate job: works one AI Studio request into a proposal. A
 * provider outage is retried; anything else (refusal, bad output, no
 * provider) ends the generation as failed with a code the admin explains.
 */
export function aiGenerateJob(deps: { workerDb: Db; provider: JsonCompletionProvider | undefined; log?: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void }): JobDefinition {
  return {
    leaseSeconds: 90,
    async handle(ctx) {
      const id = (ctx.payload as { generationId?: unknown }).generationId;
      if (typeof id !== "string") throw new PermanentJobError("bad_payload");
      const generation = await withStore(deps.workerDb, ctx.storeId, (trx) => aiRepo.markRunning(trx, id));
      if (!generation) return;
      const done = (result: Parameters<typeof aiRepo.finish>[2], meta: Parameters<typeof aiRepo.finish>[3]) => withStore(deps.workerDb, ctx.storeId, (trx) => aiRepo.finish(trx, id, result, meta));

      if (!deps.provider) {
        await done({ ok: false, code: "ai_disabled" }, { provider: "none", model: "none", inputTokens: 0, outputTokens: 0 });
        return;
      }
      const i = generation.input as { storeName?: string; language?: string; tone?: Tone; notes?: string | null; data?: Record<string, unknown> };
      const input: TaskInput = { task: generation.task as AiTask, storeName: i.storeName ?? "the shop", language: i.language ?? "en", tone: i.tone ?? "friendly", notes: i.notes ?? null, data: i.data ?? {} };
      const result = await runTask(deps.provider, input, ctx.signal);
      const meta = { provider: deps.provider.name, model: deps.provider.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
      if (!result.ok && result.retryable && ctx.attempt < ctx.maxAttempts) {
        deps.log?.("warn", "ai provider unavailable; retrying", { generationId: id, code: result.code, attempt: ctx.attempt });
        throw new Error(result.code);
      }
      await done(result.ok ? { ok: true, output: result.output as unknown as Record<string, unknown> } : { ok: false, code: result.code }, meta);
    },
  };
}
