import { z } from "zod";

/** An empty value (`KEY=` in .env) means unset. */
const unsetIfEmpty = (v: unknown) => (v === "" ? undefined : v);

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url(),
    /** The public role's connection, used only by /public/v1 (storefront reads). */
    DATABASE_PUBLIC_URL: z.url(),
    /**
     * Single sign-on through an OpenID Connect provider (later: the shared
     * Workeasy360 account). All three or none; with none, people sign up and
     * sign in with email and password only.
     */
    OIDC_ISSUER_URL: z.preprocess(unsetIfEmpty, z.url().optional()),
    OIDC_CLIENT_ID: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
    OIDC_CLIENT_SECRET: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
    ADMIN_PUBLIC_URL: z.url(),
    /** Public origin of the storefront app: shop links point here. */
    STOREFRONT_PUBLIC_URL: z.url().default("http://localhost:3001"),
    /** Recorded on stores created through the admin. */
    HOME_REGION: z.string().min(1).max(64).default("default"),
    /** S3-compatible storage for media. Unset endpoint: Amazon S3 in OBJECT_STORAGE_REGION. */
    OBJECT_STORAGE_ENDPOINT: z.preprocess(unsetIfEmpty, z.url().optional()),
    /** Where browsers reach storage for presigned uploads and views; defaults to the endpoint. */
    OBJECT_STORAGE_PUBLIC_ENDPOINT: z.preprocess(unsetIfEmpty, z.url().optional()),
    OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
    /** Both or neither; neither uses the AWS default credential chain (on EC2, the instance role). */
    OBJECT_STORAGE_ACCESS_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
    OBJECT_STORAGE_SECRET_KEY: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
    OBJECT_STORAGE_BUCKET_QUARANTINE: z.string().min(3),
    OBJECT_STORAGE_BUCKET_MEDIA: z.string().min(3),
    OBJECT_STORAGE_BUCKET_EXPORTS: z.string().min(3),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    SESSION_COOKIE_SECURE: z.stringbool().default(true),
    /** Public origin of this API, for gateway webhook URLs. Unset: the admin origin (which proxies /webhooks). */
    API_PUBLIC_URL: z.preprocess(unsetIfEmpty, z.url().optional()),
    /**
     * 32 random bytes, base64: encrypts merchants' gateway keys at rest. Unset:
     * card payments can't be connected. Generate with `openssl rand -base64 32`.
     */
    SECRETS_ENCRYPTION_KEY: z.preprocess(unsetIfEmpty, z.base64().optional()),
    /** Must match the worker's: the API only uses it to show or hide AI Studio's generate actions. */
    AI_PROVIDER: z.preprocess(unsetIfEmpty, z.enum(["disabled", "stub", "openai", "gemini"]).default("disabled")),
    AI_DAILY_LIMIT: z.coerce.number().int().min(1).max(10_000).default(100),
  })
  .superRefine((config, ctx) => {
    const oidc = [config.OIDC_ISSUER_URL, config.OIDC_CLIENT_ID, config.OIDC_CLIENT_SECRET].filter(Boolean).length;
    if (oidc !== 0 && oidc !== 3) {
      ctx.addIssue({ code: "custom", path: ["OIDC_ISSUER_URL"], message: "set OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together, or none of them" });
    }
    if (!config.OBJECT_STORAGE_ACCESS_KEY !== !config.OBJECT_STORAGE_SECRET_KEY) {
      ctx.addIssue({ code: "custom", path: ["OBJECT_STORAGE_SECRET_KEY"], message: "set both OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY, or neither" });
    }
    if (config.SECRETS_ENCRYPTION_KEY && Buffer.from(config.SECRETS_ENCRYPTION_KEY, "base64").length !== 32) {
      ctx.addIssue({ code: "custom", path: ["SECRETS_ENCRYPTION_KEY"], message: "must be 32 bytes, base64-encoded" });
    }
    if (config.NODE_ENV !== "production") return;
    // Local-only conveniences must be impossible to enable in production.
    if (!config.SESSION_COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["SESSION_COOKIE_SECURE"], message: "must be true in production" });
    }
    for (const key of ["OIDC_ISSUER_URL", "ADMIN_PUBLIC_URL", "STOREFRONT_PUBLIC_URL"] as const) {
      const value = config[key];
      if (value && new URL(value).protocol !== "https:") {
        ctx.addIssue({ code: "custom", path: [key], message: "must use https in production" });
      }
    }
  });

export type ApiConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid API configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
