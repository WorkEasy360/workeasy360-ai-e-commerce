import { hoursProblems, MAX_MINOR, type WeeklyHours } from "@workeasy/commerce";
import { z } from "zod";

/** Request schemas for Offers, Shipping, tax settings and bookings. */

const Uuid = z.uuid();
const Money = z.number().int().min(0).max(MAX_MINOR);

export const DiscountBodySchema = z
  .object({
    method: z.enum(["code", "automatic"]),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/, "Use 3 to 32 letters, numbers, dashes or underscores")
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    title: z.string().trim().min(1, "Give the offer a name").max(100),
    type: z.enum(["percentage", "fixed", "free_shipping", "buy_x_get_y"]),
    /** Percentage: basis points. Fixed: minor units. Buy X get Y: basis points off what's got (10000 = free). */
    value: z.number().int().min(0).max(MAX_MINOR),
    minSubtotalMinor: Money.nullable().default(null),
    appliesTo: z.enum(["all", "collections", "products"]).default("all"),
    targetIds: z.array(Uuid).max(100).default([]),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    usageLimit: z.number().int().min(1).max(1_000_000).nullable().default(null),
    oncePerCustomer: z.boolean().default(false),
    enabled: z.boolean().default(true),
    buyXGetY: z
      .object({
        buyQuantity: z.number().int().min(1, "Buy at least 1").max(100),
        getQuantity: z.number().int().min(1, "Get at least 1").max(100),
        getAppliesTo: z.enum(["same", "collections", "products"]).default("same"),
        getTargetIds: z.array(Uuid).max(100).default([]),
        maxApplications: z.number().int().min(1).max(100).nullable().default(null),
      })
      .nullable()
      .default(null),
  })
  .superRefine((d, ctx) => {
    if (d.type === "buy_x_get_y") {
      if (!d.buyXGetY) ctx.addIssue({ code: "custom", path: ["buyXGetY"], message: "Say what shoppers buy and what they get" });
      if (d.value < 1 || d.value > 10_000) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage off between 0.01 and 100 (100 is free)" });
      if (d.buyXGetY && d.buyXGetY.getAppliesTo !== "same" && d.buyXGetY.getTargetIds.length === 0)
        ctx.addIssue({ code: "custom", path: ["buyXGetY", "getTargetIds"], message: d.buyXGetY.getAppliesTo === "products" ? "Choose the products shoppers get" : "Choose the collections shoppers get from" });
    }
    if (d.method === "code" && !d.code) ctx.addIssue({ code: "custom", path: ["code"], message: "Enter the code shoppers type" });
    if (d.type === "percentage" && (d.value < 1 || d.value > 10_000)) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage between 0.01 and 100" });
    if (d.type === "fixed" && d.value < 1) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter the amount off" });
    if (d.appliesTo !== "all" && d.targetIds.length === 0) ctx.addIssue({ code: "custom", path: ["targetIds"], message: d.appliesTo === "products" ? "Choose at least one product" : "Choose at least one collection" });
    if (d.endsAt && Date.parse(d.endsAt) <= (d.startsAt ? Date.parse(d.startsAt) : Date.now())) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End after the start" });
  });

const Country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use two-letter country codes such as IN");

const Rate = z
  .object({
    name: z.string().trim().min(1, "Name the rate").max(100),
    kind: z.enum(["flat", "weight", "price"]),
    minValue: z.number().int().min(0).max(MAX_MINOR).nullable().default(null),
    maxValue: z.number().int().min(0).max(MAX_MINOR).nullable().default(null),
    priceMinor: Money,
    freeOverMinor: Money.nullable().default(null),
    deliveryTime: z
      .string()
      .trim()
      .max(60)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((r) => r.minValue === null || r.maxValue === null || r.maxValue >= r.minValue, { path: ["maxValue"], message: "The upper limit must be at least the lower one" });

export const ZoneBodySchema = z.object({
  name: z.string().trim().min(1, "Name the zone").max(100),
  countries: z.array(Country).min(1, "Choose at least one country").max(250),
  regions: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  postalPrefixes: z
    .array(z.string().trim().regex(/^[A-Za-z0-9 -]{1,12}$/, "Postal codes use letters, numbers and dashes"))
    .max(500)
    .default([]),
  codEnabled: z.boolean().default(true),
  rates: z.array(Rate).min(1, "Add at least one rate").max(20),
});

export const ZoneOrderBodySchema = z.object({ ids: z.array(Uuid).max(100) });

export const TaxBodySchema = z.object({
  enabled: z.boolean(),
  pricesIncludeTax: z.boolean(),
  defaultRateBps: z.number().int().min(0).max(5000),
  taxShipping: z.boolean(),
  label: z.string().trim().min(1).max(20).default("GST"),
  registrationNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .regex(/^[A-Z0-9 -]*$/, "Use letters and numbers only")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

export const BookingsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  days: z.coerce.number().int().min(1).max(366).default(60),
});

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use times like 09:30");

/** Weekly booking hours: every day listed, closed days empty. */
const Day = z.array(z.tuple([Time, Time])).max(4);
export const BookingHoursSchema = z
  .object({ mon: Day, tue: Day, wed: Day, thu: Day, fri: Day, sat: Day, sun: Day })
  .superRefine((h, ctx) => {
    for (const message of hoursProblems(h as WeeklyHours)) ctx.addIssue({ code: "custom", message });
  });
