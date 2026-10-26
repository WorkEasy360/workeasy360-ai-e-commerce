import { sql, type Transaction } from "kysely";
import type { ActorType, Database } from "../schema.js";

/**
 * The audit trail and the transactional outbox. Both are written in the same
 * transaction as the change they record, so neither can drift from it.
 */
type Trx = Transaction<Database>;

export interface AuditInput {
  storeId: string;
  actor: { type: "user"; id: string } | { type: "system" };
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string | undefined;
  /** Identifiers and before/after values only; never customer contact details or secrets. */
  metadata?: Record<string, unknown>;
}

export async function appendAudit(trx: Trx, input: AuditInput): Promise<void> {
  await trx
    .insertInto("audit_events")
    .values({
      store_id: input.storeId,
      actor_type: input.actor.type,
      actor_id: input.actor.type === "user" ? input.actor.id : null,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      request_id: input.requestId ?? null,
      metadata: input.metadata ?? {},
    })
    .execute();
}

export interface OutboxInput {
  id: string;
  storeId: string;
  eventType: string;
  aggregateId: string;
  occurredAt: Date;
  /** The envelope's `data`: references to protected records only. */
  payload: Record<string, unknown>;
  traceId?: string | undefined;
}

export async function appendOutbox(trx: Trx, input: OutboxInput): Promise<void> {
  await trx
    .insertInto("outbox_events")
    .values({
      id: input.id,
      store_id: input.storeId,
      event_type: input.eventType,
      aggregate_id: input.aggregateId,
      payload: input.payload,
      trace_id: input.traceId ?? null,
      occurred_at: input.occurredAt,
    })
    .execute();
}

export interface AuditEntry {
  id: string;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface AuditQuery {
  limit: number;
  /** Keyset: the last entry of the previous page. */
  before?: { occurredAt: string; id: string } | undefined;
  action?: string | undefined;
}

/** Newest first. `occurredAtKey` is the exact timestamp text for the next cursor. */
export async function listAudit(trx: Trx, query: AuditQuery): Promise<{ entries: Array<AuditEntry & { occurredAtKey: string }>; more: boolean }> {
  let q = trx
    .selectFrom("audit_events as a")
    .leftJoin("users as u", "u.id", "a.actor_id")
    .select([
      "a.id",
      "a.actor_type",
      "a.actor_id",
      "u.display_name",
      "a.action",
      "a.resource_type",
      "a.resource_id",
      "a.metadata",
      "a.occurred_at",
      sql<string>`a.occurred_at::text`.as("occurred_at_key"),
    ]);
  if (query.before) q = q.where(sql<boolean>`(a.occurred_at, a.id) < (${query.before.occurredAt}::timestamptz, ${query.before.id}::uuid)`);
  if (query.action) q = q.where("a.action", "=", query.action);
  const rows = await q.orderBy("a.occurred_at", "desc").orderBy("a.id", "desc").limit(query.limit + 1).execute();
  return {
    entries: rows.slice(0, query.limit).map((r) => ({
      id: r.id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      actorName: r.display_name ?? null,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      metadata: r.metadata,
      occurredAt: r.occurred_at,
      occurredAtKey: r.occurred_at_key,
    })),
    more: rows.length > query.limit,
  };
}
