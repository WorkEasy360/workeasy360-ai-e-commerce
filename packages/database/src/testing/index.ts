import type { StoreFixture } from "@workeasy/test-fixtures";
import type { Db } from "../client.js";
import { withContext, withStore } from "../context.js";

export type { TestDatabaseUrls, TestOidcSettings } from "./provided.js";

/**
 * Inserts a store fixture through the normal row-security path: each user in
 * its own user context, then store rows in the store context. Existing rows
 * are left untouched, so seeding is idempotent.
 */
export async function seedStoreFixture(db: Db, fixture: StoreFixture): Promise<void> {
  for (const { user } of fixture.members) {
    await withContext(db, { userId: user.id }, (trx) =>
      trx
        .insertInto("users")
        .values({ id: user.id, issuer: user.issuer, subject: user.subject, display_name: user.displayName })
        .onConflict((oc) => oc.doNothing())
        .execute(),
    );
  }

  await withStore(db, fixture.id, async (trx) => {
    await trx
      .insertInto("stores")
      .values({
        id: fixture.id,
        slug: fixture.slug,
        name: fixture.name,
        currency: fixture.currency,
        country: fixture.country,
        home_region: fixture.homeRegion,
        contact_email: null,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto("memberships")
      .values(fixture.members.map((m) => ({ store_id: fixture.id, user_id: m.user.id, role: m.role })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  });
}
