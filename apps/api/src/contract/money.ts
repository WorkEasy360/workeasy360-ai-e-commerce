import { MAX_MINOR } from "@workeasy/commerce";
import { z } from "zod";

/** Request schemas for Payments & Finances, refunds, fulfilments, customers and checkout capture. */

const Uuid = z.uuid();
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/** Keys are pasted from gateway dashboards: trim, and refuse anything with spaces inside. */
const Key = (label: string) => z.string().trim().min(8, `Paste your ${label}`).max(255).regex(/^\S+$/, `Paste your ${label} without spaces`);

export const PaymentAccountBodySchema = z.object({
  publicKey: Key("publishable key or key id"),
  /** Omit to keep the stored secret (e.g. when only toggling or rotating the webhook secret). */
  secretKey: Key("secret key").optional(),
  webhookSecret: Key("webhook secret").optional(),
  enabled: z.boolean().default(true),
});

export const LedgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export const RefundBodySchema = z.object({
  amountMinor: z.number().int().min(1, "Enter an amount to refund").max(MAX_MINOR),
  reason: OptionalText(500),
  /** "gateway" sends the money back to the card; "manual" records money returned outside the store. */
  method: z.enum(["gateway", "manual"]),
  restock: z.array(z.object({ orderItemId: Uuid, quantity: z.number().int().min(1).max(10_000) })).max(100).default([]),
});

export const FulfillmentBodySchema = z.object({
  items: z.array(z.object({ orderItemId: Uuid, quantity: z.number().int().min(1).max(10_000) })).min(1, "Choose at least one item").max(100),
  carrier: OptionalText(100),
  trackingNumber: OptionalText(100),
  trackingUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Use a full https:// tracking link")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  notify: z.boolean().default(true),
});

export const CustomerListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const CheckoutCaptureBodySchema = z.object({
  checkoutId: Uuid.optional(),
  email: z.email().trim().toLowerCase().max(254),
  name: OptionalText(200),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+0-9 ()-]*$/)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  items: z.array(z.object({ variantId: Uuid, quantity: z.number().int().min(1).max(99) })).min(1).max(50),
});

export const RazorpayConfirmBodySchema = z.object({
  razorpayOrderId: z.string().min(1).max(100),
  paymentId: z.string().min(1).max(100),
  signature: z.string().regex(/^[0-9a-f]{64}$/i),
});
