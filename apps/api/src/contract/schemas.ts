import { STORE_PERMISSIONS, STORE_ROLES } from "@workeasy/auth";
import { z } from "zod";

/**
 * Request and response shapes for /api/v1 and /public/v1. Requests are
 * validated with these schemas; responses are typed by them so the admin and
 * storefront clients can rely on the same contract.
 */

const Uuid = z.uuid();

/** Addresses that would collide with app routes or read as official. */
export const RESERVED_STORE_SLUGS: ReadonlySet<string> = new Set([
  "admin", "api", "app", "assets", "auth", "cart", "checkout", "help", "login", "logout", "public",
  "s", "static", "store", "stores", "support", "www", "workeasy", "workeasy360",
]);

export const StoreSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, "Use 3–48 lowercase letters, numbers and hyphens, starting and ending with a letter or number")
  .refine((slug) => !slug.includes("--"), "Avoid double hyphens")
  .refine((slug) => !RESERVED_STORE_SLUGS.has(slug), "This address is reserved. Choose another");

const StoreName = z.string().trim().min(1, "Enter a store name").max(120);
const Currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as INR or USD");
const Country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code such as IN or US");
const Locale = z.string().trim().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Use a language code such as en or hi");
const Timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      return Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone !== "";
    } catch {
      return false;
    }
  }, "Unknown time zone");
const ContactEmail = z.email("Enter a valid email").trim().toLowerCase().max(254);

export const CreateStoreBodySchema = z.object({
  name: StoreName,
  slug: StoreSlug,
  currency: Currency.default("INR"),
  country: Country.default("IN"),
  defaultLocale: Locale.default("en"),
  timezone: Timezone.default("Asia/Kolkata"),
  contactEmail: ContactEmail.optional(),
});

export const StorePatchBodySchema = z
  .object({
    name: StoreName,
    slug: StoreSlug,
    currency: Currency,
    country: Country,
    defaultLocale: Locale,
    timezone: Timezone,
    contactEmail: ContactEmail.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Change at least one setting");

export const StoreBodySchema = z.object({
  id: Uuid,
  slug: z.string(),
  name: z.string(),
  status: z.enum(["active", "suspended"]),
  currency: z.string(),
  country: z.string(),
  defaultLocale: z.string(),
  timezone: z.string(),
  contactEmail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StoreBody = z.infer<typeof StoreBodySchema>;

const Role = z.enum(STORE_ROLES);
const Permissions = z.array(z.enum(STORE_PERMISSIONS));

export const MeResponseSchema = z.object({
  user: z.object({ id: Uuid, displayName: z.string().nullable() }),
  stores: z.array(z.object({ id: Uuid, name: z.string(), slug: z.string(), role: Role, permissions: Permissions })),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const StoreResponseSchema = z.object({ store: StoreBodySchema, role: Role, permissions: Permissions });
export type StoreResponse = z.infer<typeof StoreResponseSchema>;

export const SlugAvailabilityResponseSchema = z.object({ slug: z.string(), available: z.boolean(), reason: z.string().optional() });
export type SlugAvailabilityResponse = z.infer<typeof SlugAvailabilityResponseSchema>;

export const MemberListResponseSchema = z.object({
  members: z.array(z.object({ userId: Uuid, displayName: z.string().nullable(), role: Role, status: z.enum(["active", "revoked"]), joinedAt: z.string() })),
});
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
  action: z.string().regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/).optional(),
});

export const AuditListResponseSchema = z.object({
  entries: z.array(
    z.object({
      id: Uuid,
      actor: z.object({ type: z.enum(["user", "system"]), id: Uuid.nullable(), displayName: z.string().nullable() }),
      action: z.string(),
      resourceType: z.string(),
      resourceId: Uuid,
      metadata: z.record(z.string(), z.unknown()),
      occurredAt: z.string(),
    }),
  ),
  nextCursor: z.string().optional(),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

export const PublicStoreResponseSchema = z.object({
  store: z.object({ slug: z.string(), name: z.string(), currency: z.string(), country: z.string(), defaultLocale: z.string() }),
});
export type PublicStoreResponse = z.infer<typeof PublicStoreResponseSchema>;
