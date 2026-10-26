import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { bootstrapDatabase } from "./bootstrap.js";
import { OWNERSHIP_MARK } from "./roles.js";

/** Setup on a shared cluster: it changes only what it created, never another app's database. */
const urls = inject("testDatabase");
const foreign = `other_app_${randomUUID().slice(0, 8)}`;
const adminUrl = (database: string) => Object.assign(new URL(urls.admin), { pathname: `/${database}` }).toString();
const roleUrls = { owner: urls.owner, api: urls.api, worker: urls.worker, public: urls.public };

async function asAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: adminUrl("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

afterAll(async () => {
  await asAdmin((c) => c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(foreign)} WITH (FORCE)`));
});

describe("database setup on a shared cluster", () => {
  it("marks the roles and database it created", async () => {
    const marks = await asAdmin(async (c) => ({
      roles: (await c.query<{ mark: string | null }>("SELECT shobj_description(oid, 'pg_authid') AS mark FROM pg_roles WHERE rolname LIKE 'wec\\_%'")).rows.map((r) => r.mark),
      database: (await c.query<{ mark: string | null }>("SELECT shobj_description(oid, 'pg_database') AS mark FROM pg_database WHERE datname = $1", [new URL(urls.owner).pathname.slice(1)])).rows[0]?.mark,
    }));
    expect(marks.roles).toEqual([OWNERSHIP_MARK, OWNERSHIP_MARK, OWNERSHIP_MARK, OWNERSHIP_MARK]);
    expect(marks.database).toBe(OWNERSHIP_MARK);
  });

  it("refuses to take over a database another application created, and leaves it as it was", async () => {
    await asAdmin((c) => c.query(`CREATE DATABASE ${c.escapeIdentifier(foreign)}`));
    await expect(bootstrapDatabase({ adminUrl: urls.admin, database: foreign, roleUrls })).rejects.toThrow(`Database "${foreign}" already exists on this cluster but wasn't created for this application; refusing to change it.`);
    const connectable = await asAdmin(async (c) => (await c.query<{ ok: boolean }>("SELECT has_database_privilege('wec_api', $1, 'CONNECT') AS ok", [foreign])).rows[0]!.ok);
    // Untouched: PUBLIC keeps its default CONNECT and nothing was granted or revoked.
    expect(connectable).toBe(true);
    const schemas = await new Client({ connectionString: adminUrl(foreign) });
    await schemas.connect();
    try {
      expect((await schemas.query("SELECT 1 FROM pg_namespace WHERE nspname = 'app'")).rowCount).toBe(0);
    } finally {
      await schemas.end();
    }
  });
});
