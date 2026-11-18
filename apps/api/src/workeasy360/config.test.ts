import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

/** The WORKEASY360_* settings are refused when they could not work, or would be unsafe (docs/workeasy360-sso.md). */
const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://api:x@127.0.0.1:5432/commerce",
  DATABASE_PUBLIC_URL: "postgres://public:x@127.0.0.1:5432/commerce",
  ADMIN_PUBLIC_URL: "http://localhost:3000",
  OBJECT_STORAGE_BUCKET_QUARANTINE: "quarantine",
  OBJECT_STORAGE_BUCKET_MEDIA: "media",
  OBJECT_STORAGE_BUCKET_EXPORTS: "exports",
  SESSION_SECRET: "a-session-secret-that-is-long-enough-0000",
  SESSION_COOKIE_SECURE: "false",
};
const w360 = {
  WORKEASY360_ISSUER: "http://127.0.0.1:8031",
  WORKEASY360_CLIENT_ID: "commerce-client",
  WORKEASY360_KEY_ID: "cred-1",
  WORKEASY360_PRIVATE_KEY_FILE: "./secrets/workeasy360.pem",
};

describe("WorkEasy360 configuration", () => {
  it("is optional", () => {
    const config = loadConfig(base);
    expect(config.WORKEASY360_ISSUER).toBeUndefined();
    expect(config.WORKEASY360_SSO_ONLY).toBe(false);
  });

  it("accepts a loopback http issuer outside production, with the defaults of the integration kit", () => {
    expect(loadConfig({ ...base, ...w360 })).toMatchObject({
      WORKEASY360_PRODUCT_CODE: "ai_commerce",
      WORKEASY360_SCOPES: "openid email profile organization",
      WORKEASY360_DEFAULT_ROLE: "staff",
      WORKEASY360_PROVISION_STORES: true,
    });
  });

  it.each([
    [{ WORKEASY360_ISSUER: "http://127.0.0.1:8031/" }, /must not end with a slash/],
    [{ WORKEASY360_ISSUER: "http://accounts.example.test" }, /must use https/],
    [{ WORKEASY360_KEY_ID: "" }, /together, or none of them/],
    [{ WORKEASY360_SCOPES: "openid profile" }, /must include openid and email/],
    [{ WORKEASY360_REDIRECT_URI: "http://localhost:3000/auth/callback" }, /must be http:\/\/localhost:3000\/auth\/workeasy360\/callback/],
    [{ WORKEASY360_POST_LOGOUT_REDIRECT_URI: "https://elsewhere.example/" }, /must be on the admin origin/],
    [{ OIDC_ISSUER_URL: "http://127.0.0.1:8031", OIDC_CLIENT_ID: "x", OIDC_CLIENT_SECRET: "y" }, /must not be the WorkEasy360 issuer/],
  ])("refuses %o", (override, message) => {
    expect(() => loadConfig({ ...base, ...w360, ...override })).toThrow(message);
  });

  it("refuses SSO-only without WorkEasy360, and plain http in production", () => {
    expect(() => loadConfig({ ...base, WORKEASY360_SSO_ONLY: "true" })).toThrow(/needs WorkEasy360 sign-in/);
    expect(() =>
      loadConfig({ ...base, ...w360, NODE_ENV: "production", SESSION_COOKIE_SECURE: "true", ADMIN_PUBLIC_URL: "https://admin.example.test", STOREFRONT_PUBLIC_URL: "https://shop.example.test" }),
    ).toThrow(/must use https \(plain http only for a loopback provider outside production\)[\s\S]*at WORKEASY360_ISSUER/);
  });
});
