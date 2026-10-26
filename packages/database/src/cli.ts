import { LOCAL_SEED_STORES } from "@workeasy/test-fixtures";
import { z } from "zod";
import { bootstrapDatabase } from "./bootstrap.js";
import { createDb } from "./client.js";
import { migrate } from "./migrate.js";
import { seedStoreFixture } from "./testing/index.js";

const Url = z.string().url();
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_ADMIN_URL: Url.optional(),
  DATABASE_MIGRATION_URL: Url,
  DATABASE_URL: Url,
  DATABASE_WORKER_URL: Url,
  DATABASE_PUBLIC_URL: Url,
});
type Env = z.infer<typeof EnvSchema>;

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function runBootstrap(env: Env): Promise<void> {
  if (!env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for bootstrap.");
  const database = databaseName(env.DATABASE_MIGRATION_URL);
  for (const url of [env.DATABASE_URL, env.DATABASE_WORKER_URL, env.DATABASE_PUBLIC_URL]) {
    if (databaseName(url) !== database) throw new Error("All DATABASE_* role URLs must point at the same database.");
  }
  await bootstrapDatabase({
    adminUrl: env.DATABASE_ADMIN_URL,
    database,
    roleUrls: {
      owner: env.DATABASE_MIGRATION_URL,
      api: env.DATABASE_URL,
      worker: env.DATABASE_WORKER_URL,
      public: env.DATABASE_PUBLIC_URL,
    },
  });
  console.log(`bootstrap: roles, database "${database}" and schema ready`);
}

async function runMigrate(env: Env): Promise<void> {
  const { applied, alreadyApplied } = await migrate({ connectionString: env.DATABASE_MIGRATION_URL });
  console.log(`migrate: ${alreadyApplied.length} already applied, ${applied.length} applied now`);
  for (const name of applied) console.log(`  + ${name}`);
}

async function runSeed(env: Env): Promise<void> {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed fixture data when NODE_ENV=production.");
  const db = createDb({ connectionString: env.DATABASE_URL, maxConnections: 2, applicationName: "workeasy-seed" });
  try {
    for (const store of LOCAL_SEED_STORES) {
      await seedStoreFixture(db, store);
      console.log(`seed: ${store.name} (/s/${store.slug}, ${store.members.length} staff)`);
    }
  } finally {
    await db.destroy();
  }
}

const commands: Record<string, (env: Env) => Promise<void>> = {
  bootstrap: runBootstrap,
  migrate: runMigrate,
  setup: async (env) => {
    await runBootstrap(env);
    await runMigrate(env);
  },
  // Deploys: provisions roles and the database when an admin URL is given
  // (first deploy, or a password change), otherwise only migrates as the owner.
  deploy: async (env) => {
    if (env.DATABASE_ADMIN_URL) await runBootstrap(env);
    else console.log("deploy: no DATABASE_ADMIN_URL; skipping role and database setup");
    await runMigrate(env);
  },
  seed: runSeed,
};

const command = process.argv[2] ?? "";
const run = commands[command];
if (!run) {
  console.error(`Usage: db <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid database configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(2);
}

try {
  await run(parsed.data);
} catch (err) {
  console.error(`db ${command} failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
