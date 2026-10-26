import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { InvalidDbContextError, withContext, withStore } from "./context.js";
import type { Database } from "./schema.js";

// Validation happens before the database is touched, so no connection is needed.
const unusedDb = {
  transaction() {
    throw new Error("database must not be used for an invalid context");
  },
} as unknown as Kysely<Database>;

describe("withContext validation", () => {
  it("requires a store or a user", async () => {
    await expect(withContext(unusedDb, {}, async () => 1)).rejects.toBeInstanceOf(InvalidDbContextError);
  });

  it.each(["", "not-a-uuid", "00000000-0000-4000-8000-00000000000", "'; SET ROLE postgres; --"])(
    "rejects store id %j",
    async (storeId) => {
      await expect(withStore(unusedDb, storeId, async () => 1)).rejects.toBeInstanceOf(InvalidDbContextError);
    },
  );

  it("rejects a malformed user id even with a valid store", async () => {
    await expect(
      withContext(unusedDb, { storeId: "00000000-0000-4000-8000-000000000001", userId: "x" }, async () => 1),
    ).rejects.toBeInstanceOf(InvalidDbContextError);
  });
});
