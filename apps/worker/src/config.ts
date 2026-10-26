import { z } from "zod";

/** An empty value (`KEY=` in .env) means unset. */
const unsetIfEmpty = (v: unknown) => (v === "" ? undefined : v);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  /** Jobs run at once. */
  WORKER_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  /** How long each iteration may keep draining due jobs before the other tasks get a turn. */
  WORKER_JOB_BUDGET_MS: z.coerce.number().int().min(1000).max(600_000).default(20_000),
  /** Longest a single loop iteration may run before liveness reports the worker as stalled. */
  WORKER_MAX_ITERATION_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300_000),
  /** The worker database role. */
  DATABASE_WORKER_URL: z.url(),
  /** S3-compatible storage for media. Unset endpoint: Amazon S3 in OBJECT_STORAGE_REGION. */
  OBJECT_STORAGE_ENDPOINT: z.preprocess(unsetIfEmpty, z.url().optional()),
  OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
  /** Both or neither; neither uses the AWS default credential chain (on EC2, the instance role). */
  OBJECT_STORAGE_ACCESS_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
  OBJECT_STORAGE_SECRET_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
  OBJECT_STORAGE_BUCKET_QUARANTINE: z.string().min(3),
  OBJECT_STORAGE_BUCKET_MEDIA: z.string().min(3),
  OBJECT_STORAGE_BUCKET_EXPORTS: z.string().min(3),
  /** clamd for upload scanning. */
  SCANNER_HOST: z.string().min(1).default("127.0.0.1"),
  SCANNER_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  /** SMTP relay for order email; unset means order emails fail as email_not_configured. */
  SMTP_HOST: z.preprocess(unsetIfEmpty, z.string().min(1).max(200).optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.preprocess(unsetIfEmpty, z.string().min(1).max(200).optional()),
  SMTP_PASSWORD: z.preprocess(unsetIfEmpty, z.string().min(1).max(500).optional()),
  MAIL_FROM: z.string().min(3).max(200).default("Workeasy360 Commerce <orders@workeasy.test>"),
  /** Links in emails: shoppers' order pages and the merchant admin. */
  STOREFRONT_PUBLIC_URL: z.url().default("http://localhost:3001"),
  ADMIN_PUBLIC_URL: z.url().default("http://localhost:3000"),
  /** AI Studio: "stub" (local, no account), "openai" or "gemini" with AI_MODEL and the key, or "disabled". */
  AI_PROVIDER: z.preprocess(unsetIfEmpty, z.enum(["disabled", "stub", "openai", "gemini"]).default("disabled")),
  AI_MODEL: z.preprocess(unsetIfEmpty, z.string().min(1).max(100).optional()),
  OPENAI_API_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
  GEMINI_API_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
}).superRefine((config, ctx) => {
  if (config.NODE_ENV === "production" && config.AI_PROVIDER === "stub") {
    ctx.addIssue({ code: "custom", path: ["AI_PROVIDER"], message: "the stub provider is for development only" });
  }
  // Static storage keys come in pairs; with neither, the AWS default credential chain is used.
  if (!config.OBJECT_STORAGE_ACCESS_KEY !== !config.OBJECT_STORAGE_SECRET_KEY) {
    ctx.addIssue({ code: "custom", path: ["OBJECT_STORAGE_SECRET_KEY"], message: "set both OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY, or neither" });
  }
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid worker configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
