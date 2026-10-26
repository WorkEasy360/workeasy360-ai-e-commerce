import type { IdentityProvider } from "@workeasy/auth";
import type { Db } from "@workeasy/database";
import { createObjectStore, type ObjectStore } from "@workeasy/files";
import { createLogger } from "@workeasy/observability";
import type { Express } from "express";
import { sql } from "kysely";
import type { Fetch } from "@workeasy/payments";
import { createApp, type AppSettings } from "./app.js";
import type { ResolveTxt } from "./routes/team.js";

/** Shared setup for API integration tests. Not part of the production bundle. */
export const TEST_ADMIN_ORIGIN = "http://localhost:3000";
export const TEST_STOREFRONT_ORIGIN = "http://localhost:3001";

export const testSettings: AppSettings = {
  adminOrigin: TEST_ADMIN_ORIGIN,
  storefrontOrigin: TEST_STOREFRONT_ORIGIN,
  sessionSecret: "integration-test-secret-integration-test-0000",
  sessionTtlMs: 60 * 60 * 1000,
  secureCookies: false,
  aiProvider: "stub",
  aiDailyLimit: 5,
};

/**
 * The local S3-compatible storage from `pnpm infra:up`, configured like the
 * API from .env (loaded by the integration global setup).
 */
export function testObjectStore(): ObjectStore {
  const env = process.env;
  const endpoint = env.OBJECT_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
  return createObjectStore({
    endpoint,
    publicEndpoint: env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? endpoint,
    region: env.OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY ?? "local-dev-access",
    secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY ?? "local-dev-secret-key",
    quarantineBucket: env.OBJECT_STORAGE_BUCKET_QUARANTINE ?? "workeasy-commerce-quarantine",
    mediaBucket: env.OBJECT_STORAGE_BUCKET_MEDIA ?? "workeasy-commerce-media",
    exportsBucket: env.OBJECT_STORAGE_BUCKET_EXPORTS ?? "workeasy-commerce-exports",
  });
}

/** An identity provider for tests that must not reach sign-in. */
export const unusedIdentityProvider: IdentityProvider = {
  beginLogin: () => Promise.reject(new Error("identity provider not available in this test")),
  completeLogin: () => Promise.reject(new Error("identity provider not available in this test")),
};

/** A fixed key for encrypting gateway credentials in tests. */
export const TEST_SECRETS_KEY = Buffer.alloc(32, 7);

/** Gateways are never called unless a test supplies a fake. */
export const unusedGatewayFetch: Fetch = () => Promise.reject(new Error("gateway not available in this test"));

/**
 * `publicDb` should be a connection as the public role whenever a test calls
 * /public/v1; it defaults to `db` only for tests that never do.
 */
export function buildTestApp(
  db: Db,
  identityProvider: IdentityProvider = unusedIdentityProvider,
  settings = testSettings,
  publicDb: Db = db,
  objectStore: ObjectStore = testObjectStore(),
  logger = createLogger({ service: "api-test", level: "silent" }),
  gatewayFetch: Fetch = unusedGatewayFetch,
  resolveTxt?: ResolveTxt,
): Express {
  return createApp({
    logger,
    db,
    publicDb,
    objectStore,
    payments: { fetch: gatewayFetch, secretsKey: TEST_SECRETS_KEY },
    ...(resolveTxt ? { resolveTxt } : {}),
    identityProvider,
    settings,
    readinessChecks: { database: () => sql`SELECT 1`.execute(db) },
    isDraining: () => false,
  });
}

/** Extracts `name=value` for a cookie from Set-Cookie headers. */
export function cookieFrom(setCookie: string[] | string | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const [pair] = header.split(";");
    if (pair?.startsWith(`${name}=`)) return pair;
  }
  return undefined;
}
