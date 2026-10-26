import { handleize, isHandle, MAX_MINOR, MAX_OPTIONS, MAX_VARIANTS, optionProblems, ruleProblems, RULE_FIELDS, variantKey } from "@workeasy/commerce";
import { z } from "zod";
import { BookingHoursSchema } from "./rules.js";

/**
 * Request schemas for the catalog routes: products, collections, inventory
 * and media. Money arrives as integer minor units; the admin converts typed
 * amounts with @workeasy/commerce.
 */

const Uuid = z.uuid();
const Money = z.number().int().min(0).max(MAX_MINOR);
/** Optional text: trimmed, and an empty string means "not set". */
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .refine((h) => h === "" || isHandle(h), "Use lowercase letters, numbers and single hyphens")
  .optional();

export const PRODUCT_TYPES = ["physical", "digital", "service"] as const;
export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

const VariantSchema = z.object({
  id: Uuid.optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(MAX_OPTIONS),
  sku: OptionalText(64),
  barcode: OptionalText(64),
  priceMinor: Money,
  compareAtMinor: Money.nullable().default(null),
  costMinor: Money.nullable().default(null),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().default(null),
  trackInventory: z.boolean().default(true),
  allowBackorder: z.boolean().default(false),
  stock: z.number().int().min(-1_000_000).max(1_000_000_000).nullable().default(null),
});

const Tags = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(50)
  .default([])
  .transform((tags) => [...new Set(tags)]);

export const ProductBodySchema = z
  .object({
    type: z.enum(PRODUCT_TYPES),
    status: z.enum(PRODUCT_STATUSES).default("draft"),
    title: z.string().trim().min(1, "Enter a title").max(200),
    handle: Handle,
    description: z.string().max(20_000).default(""),
    vendor: OptionalText(100),
    tags: Tags,
    seoTitle: OptionalText(120),
    seoDescription: OptionalText(320),
    downloadLimit: z.number().int().min(1).max(100).nullable().default(null),
    downloadExpiryDays: z.number().int().min(1).max(3650).nullable().default(null),
    bookingDurationMinutes: z.number().int().min(5).max(1440).nullable().default(null),
    bookingNoticeHours: z.number().int().min(0).max(2160).nullable().default(null),
    bookingCapacity: z.number().int().min(1).max(1000).nullable().default(null),
    bookingHours: BookingHoursSchema.nullable().default(null),
    /** Basis points (1800 = 18%); null for the store's default rate. */
    taxRateBps: z.number().int().min(0).max(5000).nullable().default(null),
    options: z
      .array(z.object({ name: z.string().trim().min(1, "Name every option").max(60), values: z.array(z.string().trim().min(1).max(60)).min(1).max(50) }))
      .max(MAX_OPTIONS)
      .default([]),
    variants: z.array(VariantSchema).min(1, "A product needs at least one variant").max(MAX_VARIANTS),
    mediaIds: z.array(Uuid).max(50).default([]),
    fileIds: z.array(Uuid).max(20).default([]),
    collectionIds: z.array(Uuid).max(100).default([]),
  })
  .superRefine((p, ctx) => {
    for (const message of optionProblems(p.options)) ctx.addIssue({ code: "custom", path: ["options"], message });
    const seen = new Set<string>();
    p.variants.forEach((v, i) => {
      if (v.options.length !== p.options.length) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "options"], message: "Each variant needs one value per option" });
        return;
      }
      v.options.forEach((value, n) => {
        if (!p.options[n]!.values.some((x) => x.toLowerCase() === value.toLowerCase())) {
          ctx.addIssue({ code: "custom", path: ["variants", i, "options", n], message: `"${value}" is not a value of ${p.options[n]!.name}` });
        }
      });
      const key = variantKey(v.options);
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["variants", i], message: "Two variants have the same option values" });
      seen.add(key);
      if (v.compareAtMinor !== null && v.compareAtMinor <= v.priceMinor) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "compareAtMinor"], message: "Compare-at price must be higher than the price" });
      }
    });
    const skus = p.variants.map((v) => v.sku?.toLowerCase()).filter(Boolean);
    if (new Set(skus).size !== skus.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Two variants have the same SKU" });
    if (p.type === "service" && p.bookingDurationMinutes === null) {
      ctx.addIssue({ code: "custom", path: ["bookingDurationMinutes"], message: "Set how long a booking lasts" });
    }
    if (p.type !== "digital" && p.fileIds.length > 0) ctx.addIssue({ code: "custom", path: ["fileIds"], message: "Only digital products deliver files" });
  })
  .transform((p) => ({ ...p, handle: p.handle || handleize(p.title) }));
export type ProductBody = z.infer<typeof ProductBodySchema>;

export const ProductListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});

export const BulkProductsBodySchema = z.object({
  ids: z.array(Uuid).min(1).max(250),
  action: z.enum(["activate", "draft", "archive", "delete"]),
});

export const ImportQuerySchema = z.object({ dryRun: z.stringbool().default(true) });

const RuleSchema = z.object({
  field: z.enum(RULE_FIELDS),
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "starts_with", "greater_than", "less_than"]),
  value: z.string().trim().max(200),
});

export const RulesSchema = z
  .object({ match: z.enum(["all", "any"]), conditions: z.array(RuleSchema).max(10) })
  .superRefine((rules, ctx) => {
    for (const message of ruleProblems(rules)) ctx.addIssue({ code: "custom", path: ["conditions"], message });
  });

export const CollectionBodySchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title").max(200),
    handle: Handle,
    description: z.string().max(5000).default(""),
    kind: z.enum(["manual", "automated"]),
    rules: RulesSchema.nullable().default(null),
    sortOrder: z.enum(["manual", "newest", "title", "price_asc", "price_desc"]).default("manual"),
    imageId: Uuid.nullable().default(null),
    published: z.boolean().default(true),
    seoTitle: OptionalText(120),
    seoDescription: OptionalText(320),
    productIds: z.array(Uuid).max(1000).default([]),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "automated" && !c.rules) ctx.addIssue({ code: "custom", path: ["rules"], message: "Add conditions for an automated collection" });
    if (c.kind === "automated" && c.sortOrder === "manual") ctx.addIssue({ code: "custom", path: ["sortOrder"], message: "Automated collections can't be sorted by hand" });
    if (new Set(c.productIds).size !== c.productIds.length) ctx.addIssue({ code: "custom", path: ["productIds"], message: "A product is listed twice" });
  })
  .transform((c) => ({ ...c, handle: c.handle || handleize(c.title), rules: c.kind === "automated" ? c.rules : null }));

export const InventoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  filter: z.enum(["all", "low", "out"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(500).optional(),
});

export const AdjustStockBodySchema = z.object({
  mode: z.enum(["add", "set"]),
  quantity: z.number().int().min(-1_000_000).max(1_000_000_000),
  reason: z.enum(["received", "correction", "damaged", "returned"]),
  note: OptionalText(500),
});

export const ThresholdBodySchema = z.object({ lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable() });

export const MediaUploadBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().toLowerCase().min(3).max(100),
  byteSize: z.number().int().min(1),
  /** "file" for a digital product's deliverable (kept private); otherwise taken from the content type. */
  purpose: z.enum(["media", "file"]).default("media"),
  folder: z.string().trim().max(100).default(""),
});

export const MediaPatchBodySchema = z
  .object({
    altText: z.string().trim().max(500),
    folder: z.string().trim().max(100),
    filename: z.string().trim().min(1).max(200),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Change at least one field");

export const MediaListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["image", "video", "file"]).optional(),
  ready: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().min(1).max(500).optional(),
});
