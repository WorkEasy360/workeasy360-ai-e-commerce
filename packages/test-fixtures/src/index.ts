import { randomUUID } from "node:crypto";

/**
 * Plain-data fixtures for stores, users and staff memberships. Seeding lives
 * in `@workeasy/database/testing` so this package stays dependency-free.
 */

/** Issuer used for fixture identities; never a real identity provider. */
export const FIXTURE_ISSUER = "https://idp.workeasy.test/fixtures";

/** Issuer of the local Dex provider in infra/dex/config.yaml. */
export const LOCAL_OIDC_ISSUER = "http://localhost:5556/dex";

/**
 * The `sub` claim Dex issues for a static-password user: base64url (no
 * padding) of a protobuf message { 1: userID, 2: connectorID }.
 */
export function dexSubject(userId: string, connectorId = "local"): string {
  const field = (number: number, value: string) => {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > 127) throw new Error("Value too long for a single-byte protobuf length.");
    return Buffer.concat([Buffer.from([(number << 3) | 2, bytes.length]), bytes]);
  };
  return Buffer.concat([field(1, userId), field(2, connectorId)]).toString("base64url");
}

/** Sign-in emails for the local Dex users (password: local-dev-password). */
export const LOCAL_DEX_LOGINS = {
  ashaAcmeOwner: "asha@acme.test",
  carlosAcmeStaff: "carlos@acme.test",
  graceGlobexOwner: "grace@globex.test",
  anaGlobexAnalyst: "ana@globex.test",
  ninaNoStore: "nina@nowhere.test",
} as const;

export const LOCAL_DEX_PASSWORD = "local-dev-password";

export type FixtureRole = "owner" | "admin" | "staff" | "fulfillment" | "analyst";

export interface UserFixture {
  id: string;
  issuer: string;
  subject: string;
  displayName: string;
}

export interface MemberFixture {
  user: UserFixture;
  role: FixtureRole;
}

export interface StoreFixture {
  id: string;
  slug: string;
  name: string;
  currency: string;
  country: string;
  homeRegion: string;
  members: MemberFixture[];
}

function user(id: string, displayName: string): UserFixture {
  return { id, issuer: FIXTURE_ISSUER, subject: `fixture-${id}`, displayName };
}

/**
 * A store with unique random IDs and slug (an owner and an analyst), so
 * concurrent test files never collide.
 */
export function createStoreFixture(label: string): StoreFixture {
  const owner = user(randomUUID(), `${label} owner`);
  const analyst = user(randomUUID(), `${label} analyst`);
  return {
    id: randomUUID(),
    slug: `t-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    name: `${label} (fixture)`,
    currency: "INR",
    country: "IN",
    homeRegion: "local",
    members: [
      { user: owner, role: "owner" },
      { user: analyst, role: "analyst" },
    ],
  };
}

/** A user who signs in through the local Dex provider; the user ID doubles as the Dex userID. */
function localDexUser(id: string, displayName: string): UserFixture {
  return { id, issuer: LOCAL_OIDC_ISSUER, subject: dexSubject(id), displayName };
}

/**
 * Two fixed stores for local development (`pnpm db:seed`); IDs are stable so
 * seeding is idempotent. Their staff can sign in through local Dex.
 */
export const LOCAL_SEED_STORES: readonly StoreFixture[] = (() => {
  const acmeOwner = localDexUser("00000000-0000-4000-8000-00000000a001", "Asha Owner");
  const acmeStaff = localDexUser("00000000-0000-4000-8000-00000000a002", "Carlos Staff");
  const globexOwner = localDexUser("00000000-0000-4000-8000-00000000b001", "Grace Owner");
  const globexAnalyst = localDexUser("00000000-0000-4000-8000-00000000b002", "Ana Analyst");
  return [
    {
      id: "00000000-0000-4000-8000-0000000000a0",
      slug: "demo",
      name: "Acme Coffee Roasters",
      currency: "INR",
      country: "IN",
      homeRegion: "local",
      members: [
        { user: acmeOwner, role: "owner" },
        { user: acmeStaff, role: "staff" },
      ],
    },
    {
      id: "00000000-0000-4000-8000-0000000000b0",
      slug: "globex-studio",
      name: "Globex Studio",
      currency: "USD",
      country: "US",
      homeRegion: "local",
      members: [
        { user: globexOwner, role: "owner" },
        { user: globexAnalyst, role: "analyst" },
      ],
    },
  ];
})();
