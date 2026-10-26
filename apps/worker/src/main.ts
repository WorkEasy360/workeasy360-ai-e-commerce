import { analyticsRepo, createDb, moneyRepo, withStore } from "@workeasy/database";
import { createObjectStore } from "@workeasy/files";
import { providerFromSettings } from "@workeasy/ai";
import { createMailer } from "@workeasy/mail";
import { dispatchOutbox, runJobs, type JobDeps } from "@workeasy/jobs";
import { createLogger } from "@workeasy/observability";
import { loadConfig } from "./config.js";
import { createHealthServer } from "./health.js";
import { createRegistry } from "./jobs.js";
import { startRunner, type PollingTask } from "./runner.js";

const config = loadConfig();
const logger = createLogger({ service: "worker", level: config.LOG_LEVEL });

// Enough connections for the concurrent jobs plus the other tasks.
const workerDb = createDb({ connectionString: config.DATABASE_WORKER_URL, maxConnections: config.WORKER_JOB_CONCURRENCY + 4, applicationName: "workeasy-commerce-worker" });

const jobDeps: JobDeps = { workerDb, log: (level, message, fields) => logger[level](fields, message) };
const registry = createRegistry({
  media: {
    workerDb,
    store: createObjectStore({
      endpoint: config.OBJECT_STORAGE_ENDPOINT,
      region: config.OBJECT_STORAGE_REGION,
      accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
      quarantineBucket: config.OBJECT_STORAGE_BUCKET_QUARANTINE,
      mediaBucket: config.OBJECT_STORAGE_BUCKET_MEDIA,
      exportsBucket: config.OBJECT_STORAGE_BUCKET_EXPORTS,
    }),
    scanner: { host: config.SCANNER_HOST, port: config.SCANNER_PORT },
    log: jobDeps.log!,
  },
  ai: { workerDb, provider: providerFromSettings(config) },
  orderEmails: {
    workerDb,
    mailer: config.SMTP_HOST
      ? createMailer({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE, user: config.SMTP_USER, password: config.SMTP_PASSWORD, from: config.MAIL_FROM })
      : undefined,
    storefrontUrl: config.STOREFRONT_PUBLIC_URL,
    adminUrl: config.ADMIN_PUBLIC_URL,
    log: jobDeps.log!,
  },
});

const ROLLUP_EVERY_MS = 5 * 60 * 1000;
let lastRollup = 0;

const tasks: PollingTask[] = [
  {
    // Committed outbox events become jobs; a crash before this runs only delays them.
    name: "dispatch-outbox",
    async run() {
      while ((await dispatchOutbox(jobDeps, registry, 100)).events === 100);
    },
  },
  {
    name: "run-jobs",
    async run(signal) {
      // Drain everything that is due, a batch at a time, within the iteration's budget.
      const deadline = Date.now() + config.WORKER_JOB_BUDGET_MS;
      while (!signal.aborted && Date.now() < deadline && (await runJobs(jobDeps, registry, 50, config.WORKER_JOB_CONCURRENCY)) > 0);
    },
  },
  {
    // Card orders not paid within their window release their stock.
    name: "expire-card-orders",
    async run() {
      const cancelled = await moneyRepo.expireCardOrders(workerDb);
      if (cancelled > 0) logger.info({ cancelled }, "cancelled unpaid card orders");
    },
  },
  {
    // Daily analytics for stores with recent visits or orders, every few minutes; raw events expire after 90 days.
    name: "analytics-rollup",
    async run() {
      if (Date.now() - lastRollup < ROLLUP_EVERY_MS) return;
      lastRollup = Date.now();
      const stores = await analyticsRepo.activeStores(workerDb, new Date(Date.now() - 2 * 86_400_000));
      for (const store_id of stores) {
        await withStore(workerDb, store_id, async (trx) => {
          const store = await trx.selectFrom("stores").select("timezone").executeTakeFirst();
          if (store) await analyticsRepo.rollupRecent(trx, store_id, store.timezone, 7);
        });
      }
      const purged = await analyticsRepo.purgeOldEvents(workerDb);
      if (stores.length > 0 || purged > 0) logger.info({ stores: stores.length, purged }, "analytics rolled up");
    },
  },
];

const runner = startRunner({ tasks, intervalMs: config.WORKER_POLL_INTERVAL_MS, logger });
logger.info({ tasks: tasks.map((t) => t.name), jobTypes: Object.keys(registry), intervalMs: config.WORKER_POLL_INTERVAL_MS }, "worker started");

const health = createHealthServer({
  lastIterationAt: runner.lastIterationAt,
  // Tasks may legitimately take a while; only a loop that stops iterating is unhealthy.
  maxStalenessMs: Math.max(config.WORKER_POLL_INTERVAL_MS * 3, config.WORKER_MAX_ITERATION_MS),
});
health.listen(config.WORKER_HEALTH_PORT, () => {
  logger.info({ port: config.WORKER_HEALTH_PORT }, "worker health endpoint listening");
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker stopping; finishing in-flight work");
  await runner.stop();
  health.close();
  await workerDb.destroy();
  logger.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", (s) => void shutdown(s));
process.on("SIGINT", (s) => void shutdown(s));
