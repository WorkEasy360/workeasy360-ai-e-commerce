import type { Db } from "@workeasy/database";
import { PermanentJobError, RetryLaterError, type JobDefinition } from "@workeasy/jobs";
import { headerSafe, type Mailer } from "./mailer.js";

/** The invitations.send job: emails a new staff invitation link to the address the inviter gave. */
export const INVITATION_SEND_JOB = "invitations.send";
export const INVITATION_CREATED_V1 = "invitation.created.v1";

const ROLE_NAMES: Record<string, string> = { owner: "an owner", admin: "an admin", staff: "staff", fulfillment: "fulfilment staff", analyst: "an analyst" };

export function invitationEmail(input: { storeName: string; inviter: string | null; role: string; url: string }): { subject: string; text: string } {
  const who = input.inviter ? `${input.inviter} has invited you` : "You've been invited";
  const text = [
    `${who} to help run ${input.storeName} on Workeasy360, as ${ROLE_NAMES[input.role] ?? input.role}.`,
    "",
    "Accept the invitation:",
    input.url,
    "",
    "The link works once and expires in 7 days. If you weren't expecting this, you can ignore it.",
  ].join("\n");
  return { subject: headerSafe(`Join ${input.storeName} on Workeasy360`), text };
}

export function invitationSendJob(deps: { workerDb: Db; mailer: Mailer | undefined; log?: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void }): JobDefinition {
  return {
    events: [INVITATION_CREATED_V1],
    async handle(ctx) {
      const d = (ctx.payload.data ?? {}) as { email?: unknown; storeName?: unknown; inviter?: unknown; role?: unknown; url?: unknown };
      if (typeof d.email !== "string" || typeof d.url !== "string" || typeof d.storeName !== "string" || typeof d.role !== "string") throw new PermanentJobError("bad_payload");
      if (!deps.mailer) throw new PermanentJobError("email_not_configured");
      const m = invitationEmail({ storeName: d.storeName, inviter: typeof d.inviter === "string" ? d.inviter : null, role: d.role, url: d.url });
      const result = await deps.mailer.send({ to: [d.email], subject: m.subject, text: m.text, messageId: `<${ctx.dedupeKey}.invite@team.workeasy360>` });
      if (!result.ok) {
        deps.log?.("warn", "invitation email not accepted", { code: result.code });
        if (result.retryable) throw new RetryLaterError(result.code, 60_000);
        throw new PermanentJobError(result.code);
      }
    },
  };
}
