import { describe, expect, it } from "vitest";
import { canAssignRole, STORE_PERMISSIONS, storePermissions } from "./permissions.js";

describe("storePermissions", () => {
  it("gives owners everything and admins everything except managing the store itself", () => {
    expect(storePermissions({ role: "owner", status: "active" }).size).toBe(STORE_PERMISSIONS.length);
    const admin = storePermissions({ role: "admin", status: "active" });
    expect(admin.has("store.manage")).toBe(false);
    expect(admin.has("payments.manage")).toBe(true);
    expect(admin.has("orders.refund")).toBe(true);
    expect(admin.has("members.manage")).toBe(true);
  });

  it("lets staff run the catalog and orders but not money, shipping or settings", () => {
    const staff = storePermissions({ role: "staff", status: "active" });
    expect(staff.has("products.manage")).toBe(true);
    expect(staff.has("orders.manage")).toBe(true);
    expect(staff.has("orders.refund")).toBe(false);
    expect(staff.has("payments.manage")).toBe(false);
    expect(staff.has("finances.read")).toBe(false);
    expect(staff.has("settings.manage")).toBe(false);
  });

  it("limits fulfillment to orders and stock", () => {
    expect([...storePermissions({ role: "fulfillment", status: "active" })].toSorted()).toEqual(
      ["customers.read", "inventory.manage", "inventory.read", "orders.manage", "orders.read", "products.read"],
    );
  });

  it("gives analysts read-only access", () => {
    const analyst = storePermissions({ role: "analyst", status: "active" });
    expect([...analyst].every((p) => p.endsWith(".read"))).toBe(true);
    expect(analyst.has("finances.read")).toBe(true);
  });

  it("gives revoked or missing memberships nothing, even owners", () => {
    expect(storePermissions({ role: "owner", status: "revoked" }).size).toBe(0);
    expect(storePermissions(undefined).size).toBe(0);
  });
});

describe("canAssignRole", () => {
  it("allows only roles at or below the assigner's", () => {
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "staff")).toBe(true);
    expect(canAssignRole("staff", "admin")).toBe(false);
  });
});
