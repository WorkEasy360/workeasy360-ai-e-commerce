import { MEDIA_SCAN_JOB, mediaScanJob, type MediaScanDeps } from "@workeasy/files";
import type { JsonCompletionProvider } from "@workeasy/ai";
import { aiRepo, type Db } from "@workeasy/database";
import type { JobRegistry } from "@workeasy/jobs";
import { aiGenerateJob } from "./ai-job.js";
import { INVITATION_SEND_JOB, invitationSendJob, ORDER_NOTIFY_JOB, ORDER_SHIPPED_JOB, orderNotifyJob, orderShippedJob, REVIEW_REQUEST_JOB, reviewRequestJob, type OrderEmailDeps } from "@workeasy/mail";

/**
 * The job types this worker runs and the events that create them. Modules
 * register theirs as they arrive (order emails, inventory reservation expiry,
 * AI Studio generations, analytics rollups). Events no type subscribes to are
 * marked dispatched with no jobs.
 */
export function createRegistry(deps: { media: MediaScanDeps; orderEmails: OrderEmailDeps; ai: { workerDb: Db; provider: JsonCompletionProvider | undefined } }): JobRegistry {
  return {
    // Enqueued by the API when an upload finishes.
    [MEDIA_SCAN_JOB]: mediaScanJob(deps.media),
    // Created from order.placed.v1 events.
    [ORDER_NOTIFY_JOB]: orderNotifyJob(deps.orderEmails),
    // Created from order.fulfilled.v1 events when the merchant asks to notify the customer.
    [ORDER_SHIPPED_JOB]: orderShippedJob(deps.orderEmails),
    // Created when an order is fully fulfilled; waits until the store's chosen number of days have passed.
    [REVIEW_REQUEST_JOB]: reviewRequestJob(deps.orderEmails),
    // Enqueued by the API when a merchant asks AI Studio for something.
    [aiRepo.AI_GENERATE_JOB]: aiGenerateJob(deps.ai),
    // Created from invitation.created.v1 when the inviter gave an email address.
    [INVITATION_SEND_JOB]: invitationSendJob(deps.orderEmails),
  };
}
