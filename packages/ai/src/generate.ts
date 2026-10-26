import { ProviderError, type JsonCompletionProvider, type Usage } from "./provider.js";
import { buildPrompt, MAX_OUTPUT, SYSTEM_PROMPT, validateOutput, type TaskInput, type TaskOutput } from "./tasks.js";

/** How long one provider call may take before it's abandoned (and retried). */
export const PROVIDER_TIMEOUT_MS = 45_000;

export type GenerationResult = { ok: true; output: TaskOutput; usage: Usage } | { ok: false; code: string; retryable: boolean; usage: Usage };

/** Runs one task against the provider and validates what comes back. */
export async function runTask(provider: JsonCompletionProvider, input: TaskInput, signal: AbortSignal): Promise<GenerationResult> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]);
  try {
    const { text, usage } = await provider.complete({ system: SYSTEM_PROMPT, messages: [{ role: "user", content: buildPrompt(input) }], maxOutputTokens: MAX_OUTPUT[input.task], signal: timeout });
    const checked = validateOutput(input.task, text);
    return checked.ok ? { ok: true, output: checked.output, usage } : { ok: false, code: checked.code, retryable: false, usage };
  } catch (err) {
    if (err instanceof ProviderError) return { ok: false, code: err.code, retryable: err.retryable, usage: err.usage };
    throw err;
  }
}
