/**
 * Store roles and permissions (docs/03-roadmap.md). Pure functions: callers load the
 * membership from the database and the server enforces the result on every
 * request and job. The admin uses the same list only to hide what a role
 * cannot open; hiding is never the protection.
 */
export const STORE_ROLES = ["owner", "admin", "staff", "fulfillment", "analyst"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export const STORE_PERMISSIONS = [
  // Store-level administration.
  "store.manage",
  "settings.manage",
  "members.manage",
  "audit.read",
  // Catalog.
  "products.read",
  "products.manage",
  "inventory.read",
  "inventory.manage",
  "media.manage",
  // Selling.
  "orders.read",
  "orders.manage",
  "orders.refund",
  "customers.read",
  "offers.manage",
  "shipping.manage",
  "reviews.manage",
  // Money.
  "payments.manage",
  "finances.read",
  // Insight and growth.
  "analytics.read",
  "design.manage",
  "ai.use",
] as const;
export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export type MembershipStatus = "active" | "revoked";

export interface MembershipFacts {
  role: StoreRole;
  status: MembershipStatus;
}

/**
 * Permissions per role. Only owners manage the store itself (its address,
 * suspension and plan). Fulfillment staff pick, pack and ship; analysts only
 * read. Refunds move money, so they stay with owners and admins.
 */
const ROLE_PERMISSIONS: Record<StoreRole, readonly StorePermission[]> = {
  owner: STORE_PERMISSIONS,
  admin: STORE_PERMISSIONS.filter((p) => p !== "store.manage"),
  staff: [
    "products.read",
    "products.manage",
    "inventory.read",
    "inventory.manage",
    "media.manage",
    "orders.read",
    "orders.manage",
    "customers.read",
    "offers.manage",
    "reviews.manage",
    "analytics.read",
    "design.manage",
    "ai.use",
  ],
  fulfillment: ["products.read", "inventory.read", "inventory.manage", "orders.read", "orders.manage", "customers.read"],
  analyst: ["products.read", "inventory.read", "orders.read", "customers.read", "finances.read", "analytics.read"],
};

export function isStoreRole(value: string): value is StoreRole {
  return (STORE_ROLES as readonly string[]).includes(value);
}

export function storePermissions(membership: MembershipFacts | undefined): Set<StorePermission> {
  if (!membership || membership.status !== "active") return new Set();
  return new Set(ROLE_PERMISSIONS[membership.role]);
}

/** Roles in order of authority; an inviter may hand out only roles at or below their own. */
const ROLE_RANK: Record<StoreRole, number> = { owner: 4, admin: 3, staff: 2, fulfillment: 1, analyst: 1 };

export function canAssignRole(assigner: StoreRole, role: StoreRole): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[assigner];
}
