import type { Response } from "express";
import type { Transaction } from "kysely";
import { storePermissions, STORE_PERMISSIONS, type StorePermission } from "@workeasy/auth";
import { storesRepo, withContext, type Database, type Db, type MembershipRecord, type ResolvedSession } from "@workeasy/database";
import type { z } from "zod";
import { problems, sendProblem, type FieldError } from "../http/problem.js";
import { requestIdOf } from "../http/request-context.js";

/** Shared plumbing for the store-scoped /api/v1 routes. */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Trx = Transaction<Database>;
export const NOT_VISIBLE = Symbol("not-visible");

/** Every outcome but success; it carries no body, so it fits any route's Outcome. */
export type Failure =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "conflict"; code: string; title: string };

export type Outcome<T> = { kind: "ok"; body: T; status?: number; headers?: Record<string, string> } | Failure;

export function respond<T>(res: Response, outcome: Outcome<T> | typeof NOT_VISIBLE): void {
  if (outcome === NOT_VISIBLE || outcome.kind === "not_found") problems.notFound(res);
  else if (outcome.kind === "forbidden") problems.forbidden(res);
  else if (outcome.kind === "invalid") problems.validation(res, outcome.errors);
  else if (outcome.kind === "conflict") sendProblem(res, 409, outcome.code, outcome.title);
  else {
    if (outcome.headers) res.set(outcome.headers);
    res.status(outcome.status ?? 200).json(outcome.body);
  }
}

export function sessionOf(res: Response): ResolvedSession {
  return res.locals.session as ResolvedSession;
}

export function issuesToErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : "body",
    code: issue.code.toUpperCase(),
    message: issue.message,
  }));
}

/** A field error as an outcome, for checks the schemas cannot express. */
export function invalid(field: string, message: string): Failure {
  return { kind: "invalid", errors: [{ field, code: "INVALID", message }] };
}

/** Permissions in a stable order, so clients and tests can compare lists. */
export function permissionList(membership: MembershipRecord): StorePermission[] {
  const held = storePermissions(membership);
  return STORE_PERMISSIONS.filter((p) => held.has(p));
}

/** Opaque keyset cursor: a sort value (text) and an id. */
export function encodeCursor(cursor: { at: string; id: string }): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), "utf8").toString("base64url");
}

export function decodeCursor(value: string): { at: string; id: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [at, id] = parsed as unknown[];
    if (typeof at !== "string" || at.length > 200) return undefined;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
    return { at, id };
  } catch {
    return undefined;
  }
}

export interface StoreAccess {
  /**
   * Runs `fn` in a transaction scoped to the route store and the signed-in
   * user. The store comes from the route but is only used after an active
   * membership is confirmed; otherwise the store is reported as not found so
   * its existence is never revealed.
   */
  inStore<T>(storeId: string, userId: string, fn: (trx: Trx, membership: MembershipRecord) => Promise<Outcome<T>>): Promise<Outcome<T> | typeof NOT_VISIBLE>;
  /** inStore, refusing members who hold none of `required`. */
  withPermission<T>(
    res: Response,
    storeId: string,
    required: StorePermission | readonly StorePermission[],
    fn: (trx: Trx, membership: MembershipRecord, userId: string) => Promise<Outcome<T>>,
  ): Promise<Outcome<T> | typeof NOT_VISIBLE>;
}

export function storeAccess(db: Db): StoreAccess {
  const inStore: StoreAccess["inStore"] = (storeId, userId, fn) => {
    if (!UUID_PATTERN.test(storeId)) return Promise.resolve(NOT_VISIBLE);
    return withContext(db, { storeId, userId }, async (trx) => {
      const membership = await storesRepo.getMembership(trx, userId);
      if (!membership || membership.status !== "active") return NOT_VISIBLE;
      return fn(trx, membership);
    });
  };
  return {
    inStore,
    withPermission(res, storeId, required, fn) {
      const userId = sessionOf(res).userId;
      const anyOf = typeof required === "string" ? [required] : required;
      return inStore(storeId, userId, async (trx, membership) => {
        const held = storePermissions(membership);
        if (!anyOf.some((p) => held.has(p))) return { kind: "forbidden" };
        return fn(trx, membership, userId);
      });
    },
  };
}

/** The audit actor and request reference for a change made by the signed-in user. */
export function actorOf(res: Response) {
  return { actor: { type: "user" as const, id: sessionOf(res).userId }, requestId: requestIdOf(res) };
}
