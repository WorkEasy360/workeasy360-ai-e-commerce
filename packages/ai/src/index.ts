/**
 * @workeasy/ai: AI Studio for commerce. Provider adapters (OpenAI, Gemini
 * and a local stub), the task prompts and strict validation of what models
 * return. Server only: keys and prompts never reach a browser. A result is
 * a proposal the merchant applies or discards, never a direct change.
 */
export { AI_PROVIDERS, providerFromSettings, type AiProviderName, type AiSettings } from "./config.js";
export { PROVIDER_TIMEOUT_MS, runTask, type GenerationResult } from "./generate.js";
export { geminiProvider } from "./gemini.js";
export { openAiProvider } from "./openai.js";
export { errorForStatus, ProviderError, type CompletionRequest, type JsonCompletionProvider, type Usage } from "./provider.js";
export { stubProvider } from "./stub.js";
export {
  AI_TASKS,
  buildPrompt,
  languageName,
  SYSTEM_PROMPT,
  TONES,
  validateOutput,
  type AiTask,
  type CollectionCopy,
  type ProductCopy,
  type ReviewSummary,
  type SalesInsights,
  type TaskInput,
  type TaskOutput,
  type Tone,
} from "./tasks.js";
