import { z } from "zod";

/** Request schemas for reviews and analytics. */

const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const EventsBodySchema = z.object({
  /** Random, made by the browser; never tied to a person. */
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  /** document.referrer on the session's first page. */
  referrer: z.string().max(500).nullable().optional(),
  utmSource: z.string().trim().max(60).nullable().optional(),
  events: z
    .array(
      z.object({
        type: z.enum(["page_view", "product_view", "add_to_cart", "checkout_start"]),
        path: z.string().max(300).nullable().optional(),
        productId: z.uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const ReviewBodySchema = z.object({
  productId: z.uuid(),
  rating: z.number().int().min(1, "Choose a star rating").max(5),
  title: OptionalText(120),
  body: z.string().trim().max(4000).default(""),
});

export const ReviewListQuerySchema = z.object({
  status: z.enum(["pending", "published", "hidden"]).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const ReviewPatchBodySchema = z
  .object({
    status: z.enum(["pending", "published", "hidden"]).optional(),
    reply: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
  })
  .refine((b) => b.status !== undefined || b.reply !== undefined, { message: "Nothing to change" });

export const ReviewSettingsBodySchema = z.object({
  autoPublish: z.boolean(),
  requestAfterDays: z.number().int().min(1).max(60).nullable(),
});

export const AnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "Choose 7, 30 or 90 days").default(30),
});
