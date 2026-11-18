import { STORE_ROLES } from "@workeasy/auth";
import { z } from "zod";

/** An empty value (`KEY=` in .env) means unset. */
const unsetIfEmpty = (v: unknown) => (v === "" ? undefined : v);

/** The callback path of WorkEasy360 sign-in on the admin origin (docs/workeasy360-sso.md). */
export const WORKEASY360_CALLBACK_PATH = "/auth/workeasy360/callback";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Plain http is accepted only for a provider on this machine, and never in production. */
export function isLoopbackHttp(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
}

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
    // --- WorkEasy360 Accounts (docs/workeasy360-sso.md); names as in the integration kit's .env.example ---
    /** Exactly the issuer WorkEasy360's discovery document names; no trailing slash. */
    WORKEASY360_ISSUER: z.preprocess(unsetIfEmpty, z.url().optional()),
    WORKEASY360_CLIENT_ID: z.preprocess(unsetIfEmpty, z.string().min(1).max(200).optional()),
    WORKEASY360_PRODUCT_CODE: z.preprocess(unsetIfEmpty, z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).default("ai_commerce")),
    /** Defaults to <ADMIN_PUBLIC_URL>/auth/workeasy360/callback; registered with WorkEasy360 exactly. */
    WORKEASY360_REDIRECT_URI: z.preprocess(unsetIfEmpty, z.url().optional()),
    /** Where WorkEasy360 returns the browser after its own sign-out; registered exactly. Defaults to <ADMIN_PUBLIC_URL>/. */
    WORKEASY360_POST_LOGOUT_REDIRECT_URI: z.preprocess(unsetIfEmpty, z.url().optional()),
    /** The credential id WorkEasy360 shows for the registered public key (the client assertion's kid). */
    WORKEASY360_KEY_ID: z.preprocess(unsetIfEmpty, z.string().min(1).max(200).optional()),
    /** PEM file holding the private key (RSA or EC P-256). Never in the repository or an image. */
    WORKEASY360_PRIVATE_KEY_FILE: z.preprocess(unsetIfEmpty, z.string().min(1).optional()),
    WORKEASY360_SCOPES: z.preprocess(unsetIfEmpty, z.string().default("openid email profile organization")),
    /** true: WorkEasy360 is the only way into the admin; password and generic sign-in, and their sessions, are refused. */
    WORKEASY360_SSO_ONLY: z.stringbool().default(false),
    /** The role someone gets in an organization's store they do not belong to yet; a store's creator is its owner. */
    WORKEASY360_DEFAULT_ROLE: z.preprocess(unsetIfEmpty, z.enum(STORE_ROLES).default("staff")),
    /** false: an organization's people cannot create stores; only stores linked by the operator can be signed in to. */
    WORKEASY360_PROVISION_STORES: z.stringbool().default(true),
    /** Shown on the "no access" page; defaults to the issuer. */
    WORKEASY360_PURCHASE_URL: z.preprocess(unsetIfEmpty, z.url().optional()),
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
    /**
     * The admin assistant answers within the request, so the API calls the
     * provider itself, with the same AI_PROVIDER, AI_MODEL and key as the worker.
     */
    AI_MODEL: z.preprocess(unsetIfEmpty, z.string().max(100).optional()),
    OPENAI_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
    GEMINI_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
    /** Assistant questions per store per day. */
    ASSISTANT_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(200),
  })
  .superRefine((config, ctx) => {
    const oidc = [config.OIDC_ISSUER_URL, config.OIDC_CLIENT_ID, config.OIDC_CLIENT_SECRET].filter(Boolean).length;
    if (oidc !== 0 && oidc !== 3) {
      ctx.addIssue({ code: "custom", path: ["OIDC_ISSUER_URL"], message: "set OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together, or none of them" });
    }
    const w360 = [config.WORKEASY360_ISSUER, config.WORKEASY360_CLIENT_ID, config.WORKEASY360_KEY_ID, config.WORKEASY360_PRIVATE_KEY_FILE];
    if (w360.some(Boolean) && !w360.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["WORKEASY360_ISSUER"],
        message: "set WORKEASY360_ISSUER, WORKEASY360_CLIENT_ID, WORKEASY360_KEY_ID and WORKEASY360_PRIVATE_KEY_FILE together, or none of them",
      });
    }
    if (config.WORKEASY360_SSO_ONLY && !config.WORKEASY360_ISSUER) {
      ctx.addIssue({ code: "custom", path: ["WORKEASY360_SSO_ONLY"], message: "needs WorkEasy360 sign-in to be configured" });
    }
    if (config.WORKEASY360_ISSUER) {
      const issuer = config.WORKEASY360_ISSUER;
      // Compared by exact string equality: a trailing slash would break every sign-in.
      if (issuer.endsWith("/")) ctx.addIssue({ code: "custom", path: ["WORKEASY360_ISSUER"], message: "must not end with a slash" });
      const https = new URL(issuer).protocol === "https:";
      if (!https && !(config.NODE_ENV !== "production" && isLoopbackHttp(issuer))) {
        ctx.addIssue({ code: "custom", path: ["WORKEASY360_ISSUER"], message: "must use https (plain http only for a loopback provider outside production)" });
      }
      if (config.OIDC_ISSUER_URL === issuer) {
        ctx.addIssue({ code: "custom", path: ["OIDC_ISSUER_URL"], message: "must not be the WorkEasy360 issuer; WorkEasy360 sign-in replaces it" });
      }
      const adminOrigin = new URL(config.ADMIN_PUBLIC_URL).origin;
      if (config.WORKEASY360_REDIRECT_URI) {
        const redirect = new URL(config.WORKEASY360_REDIRECT_URI);
        if (redirect.origin !== adminOrigin || redirect.pathname !== WORKEASY360_CALLBACK_PATH || redirect.search || redirect.hash) {
          ctx.addIssue({ code: "custom", path: ["WORKEASY360_REDIRECT_URI"], message: `must be ${adminOrigin}${WORKEASY360_CALLBACK_PATH}` });
        }
      }
      if (config.WORKEASY360_POST_LOGOUT_REDIRECT_URI && new URL(config.WORKEASY360_POST_LOGOUT_REDIRECT_URI).origin !== adminOrigin) {
        ctx.addIssue({ code: "custom", path: ["WORKEASY360_POST_LOGOUT_REDIRECT_URI"], message: "must be on the admin origin" });
      }
      const scopes = config.WORKEASY360_SCOPES.split(" ").filter(Boolean);
      if (!scopes.includes("openid") || !scopes.includes("email")) {
        // email_verified, which every sign-in requires, is released with the email scope.
        ctx.addIssue({ code: "custom", path: ["WORKEASY360_SCOPES"], message: "must include openid and email" });
      }
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
    for (const key of ["OIDC_ISSUER_URL", "ADMIN_PUBLIC_URL", "STOREFRONT_PUBLIC_URL", "WORKEASY360_REDIRECT_URI", "WORKEASY360_POST_LOGOUT_REDIRECT_URI"] as const) {
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
