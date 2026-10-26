import { createDb } from "@workeasy/database";
import { createObjectStore } from "@workeasy/files";
import { parseSecretKey } from "@workeasy/payments";
import { createLogger } from "@workeasy/observability";
import { sql } from "kysely";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createOidcIdentityProvider } from "./identity/oidc-provider.js";
import type { IdentityProvider } from "@workeasy/auth";

const config = loadConfig();
const logger = createLogger({ service: "api", level: config.LOG_LEVEL });
const db = createDb({ connectionString: config.DATABASE_URL, applicationName: "workeasy-commerce-api" });
const publicDb = createDb({ connectionString: config.DATABASE_PUBLIC_URL, applicationName: "workeasy-commerce-api-public" });
const adminOrigin = new URL(config.ADMIN_PUBLIC_URL).origin;

/** No single sign-on configured: the sign-in page offers email and password only. */
const passwordOnly: IdentityProvider = {
  isAvailable: () => Promise.resolve(false),
  beginLogin: () => Promise.reject(new Error("single sign-on is not configured")),
  completeLogin: () => Promise.reject(new Error("single sign-on is not configured")),
};

let draining = false;

const app = createApp({
  readinessChecks: {
    database: () => sql`SELECT 1`.execute(db),
    publicDatabase: () => sql`SELECT 1`.execute(publicDb),
  },
  isDraining: () => draining,
  logger,
  db,
  publicDb,
  objectStore: createObjectStore({
    endpoint: config.OBJECT_STORAGE_ENDPOINT,
    publicEndpoint: config.OBJECT_STORAGE_PUBLIC_ENDPOINT,
    region: config.OBJECT_STORAGE_REGION,
    accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
    quarantineBucket: config.OBJECT_STORAGE_BUCKET_QUARANTINE,
    mediaBucket: config.OBJECT_STORAGE_BUCKET_MEDIA,
    exportsBucket: config.OBJECT_STORAGE_BUCKET_EXPORTS,
  }),
  payments: {
    fetch: (url, init) => fetch(url, init),
    secretsKey: config.SECRETS_ENCRYPTION_KEY ? parseSecretKey(config.SECRETS_ENCRYPTION_KEY) : undefined,
  },
  identityProvider:
    config.OIDC_ISSUER_URL && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET
      ? createOidcIdentityProvider({
          issuerUrl: config.OIDC_ISSUER_URL,
          clientId: config.OIDC_CLIENT_ID,
          clientSecret: config.OIDC_CLIENT_SECRET,
          redirectUri: new URL("/auth/callback", adminOrigin).toString(),
          // Config validation already requires https in production.
          allowInsecureRequests: config.NODE_ENV !== "production" && new URL(config.OIDC_ISSUER_URL).protocol === "http:",
        })
      : passwordOnly,
  settings: {
    adminOrigin,
    storefrontOrigin: new URL(config.STOREFRONT_PUBLIC_URL).origin,
    sessionSecret: config.SESSION_SECRET,
    sessionTtlMs: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
    secureCookies: config.SESSION_COOKIE_SECURE,
    homeRegion: config.HOME_REGION,
    aiProvider: config.AI_PROVIDER,
    aiDailyLimit: config.AI_DAILY_LIMIT,
    ...(config.API_PUBLIC_URL ? { apiOrigin: new URL(config.API_PUBLIC_URL).origin } : {}),
  },
});

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, "api listening");
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // Readiness fails from now on; in-flight requests finish before exit.
  draining = true;
  logger.info({ signal }, "api shutting down; draining connections");
  server.close((err) => {
    void Promise.all([db.destroy(), publicDb.destroy()]).finally(() => {
      if (err) {
        logger.error({ err }, "api shutdown failed");
        process.exit(1);
      }
      process.exit(0);
    });
  });
  // Close idle keep-alive sockets so draining does not wait on them.
  server.closeIdleConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
