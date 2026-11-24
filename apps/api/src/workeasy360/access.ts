import type { RequestHandler, Response } from "express";
import { workeasy360Repo, type Db, type ResolvedSession } from "@workeasy/database";
import { problems, sendProblem } from "../http/problem.js";
import type { Workeasy360Runtime } from "./runtime.js";

/** Reads, including the CSV exports (GET): a read-only store can still view and export. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The SSO-only rule, checked on every request with a session: when
 * WORKEASY360_SSO_ONLY is on, a session opened any other way (a password, the
 * generic provider) is refused, at once, even if it has not expired.
 */
export function refuseUnlessWorkeasy360(runtime: Workeasy360Runtime | undefined, session: ResolvedSession, res: Response): boolean {
  if (!runtime?.settings.ssoOnly || session.provider === "workeasy360") return false;
  sendProblem(res, 401, "WORKEASY360_SIGN_IN_REQUIRED", "Sign in with WorkEasy360 to continue");
  return true;
}

/**
 * In front of every `/stores/:storeId/...` route (docs/workeasy360-sso.md):
 *
 * 1. A WorkEasy360 session reaches only the stores of the organization its ID
 *    token named; any other store is "not found", as for a non-member.
 * 2. A store owned by a WorkEasy360 organization is used only while the
 *    platform says the organization (and, for a WorkEasy360 session, the
 *    person) is entitled - asked on the platform's cadence, not per request.
 *    A denial answers 403 WORKEASY360_ACCESS_ENDED with the reason; a refusal
 *    of this product's client 403 WORKEASY360_ACCESS_UNVERIFIED; a write while
 *    the organization is read-only 403 WORKEASY360_READ_ONLY.
 *
 * Role permissions are then checked by the route, as before: authorization is
 * organization + store role, never `sub` alone.
 */
export function storeGate(db: Db, runtime: Workeasy360Runtime | undefined): RequestHandler {
  return async (req, res, next) => {
    const session = res.locals.session as ResolvedSession;
    const storeId = String(req.params.storeId ?? "").toLowerCase();
    // The store's organization, answered only for an active member (a non-member gets the route's 404).
    const organizationId = await workeasy360Repo.memberStoreOrganization(db, storeId, session.userId);
    if (session.provider === "workeasy360" && (!organizationId || organizationId !== session.workeasy360OrganizationId)) {
      problems.notFound(res);
      return;
    }
    if (!runtime || !organizationId) return next();

    const access = await runtime.entitlements.check(organizationId, { subject: session.provider === "workeasy360" ? session.workeasy360Subject : undefined });
    if (access.status === "refused") {
      sendProblem(res, 403, "WORKEASY360_ACCESS_UNVERIFIED", "Workeasy AI Commerce cannot confirm your access with WorkEasy360 right now. Try again in a few minutes");
      return;
    }
    if (!access.allowed) {
      sendProblem(res, 403, "WORKEASY360_ACCESS_ENDED", "Your organization's access to Workeasy AI Commerce has ended", { reason: access.reason });
      return;
    }
    if (!SAFE_METHODS.has(req.method) && !access.writeAllowed) {
      sendProblem(res, 403, "WORKEASY360_READ_ONLY", "Your organization can view and export, but not make changes, until its subscription is renewed");
      return;
    }
    next();
  };
}
