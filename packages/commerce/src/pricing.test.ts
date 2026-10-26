import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS, hoursProblems, isSlot, localParts, slotsOn, weekdayOf, zonedTime } from "./booking";
import type { DeliverySettings } from "./checkout";
import { allocate, buyXGetYDiscounts, discountProblem, NO_TAX, priceOrder, taxOn, zoneFor, type DiscountRule, type PricingLine, type ShippingZone, type TaxSettings } from "./pricing";

const delivery: DeliverySettings = { deliveryEnabled: true, deliveryFeeMinor: 5000, freeDeliveryOverMinor: 100000, pickupEnabled: true };
const tea: PricingLine = { productId: "tea", productType: "physical", unitPriceMinor: 30000, quantity: 2, weightGrams: 250, taxRateBps: null };
const ebook: PricingLine = { productId: "ebook", productType: "digital", unitPriceMinor: 19900, quantity: 1, weightGrams: 0, taxRateBps: 1800 };
const gst: TaxSettings = { enabled: true, pricesIncludeTax: true, defaultRateBps: 500, taxShipping: false, label: "GST" };
const base = { deliveryMethod: "delivery" as const, address: null, zones: [], delivery, discount: null, tax: NO_TAX };

const india: ShippingZone = {
  id: "z-in",
  name: "India",
  countries: ["IN"],
  regions: [],
  postalPrefixes: [],
  codEnabled: true,
  rates: [
    { id: "std", name: "Standard", kind: "flat", minValue: null, maxValue: null, priceMinor: 6000, freeOverMinor: 99900, deliveryTime: "4–6 days" },
    { id: "exp", name: "Express", kind: "flat", minValue: null, maxValue: null, priceMinor: 15000, freeOverMinor: null, deliveryTime: "1–2 days" },
    { id: "heavy", name: "Heavy parcel", kind: "weight", minValue: 2000, maxValue: null, priceMinor: 25000, freeOverMinor: null, deliveryTime: null },
  ],
};
const mumbai: ShippingZone = { id: "z-mum", name: "Mumbai", countries: ["IN"], regions: [], postalPrefixes: ["400"], codEnabled: false, rates: [{ id: "local", name: "Same day", kind: "flat", minValue: null, maxValue: null, priceMinor: 4000, freeOverMinor: null, deliveryTime: "Today" }] };

describe("allocate", () => {
  it("splits in proportion and never loses a unit", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [60000, 19900])).toEqual([751, 249]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });
});

describe("discounts", () => {
  const ten: DiscountRule = { id: "d1", code: "CHAI10", title: "10% off", type: "percentage", value: 1000, minSubtotalMinor: null, productIds: null };

  it("takes a percentage off and spreads it over the lines", () => {
    const p = priceOrder({ ...base, lines: [tea, ebook], discount: ten });
    expect(p.subtotalMinor).toBe(79900);
    expect(p.discountMinor).toBe(7990);
    expect(p.lines.map((l) => l.discountMinor)).toEqual([6000, 1990]);
    expect(p.totalMinor).toBe(79900 - 7990 + 5000);
  });

  it("limits a discount to its products and a fixed amount to their value", () => {
    const fixed: DiscountRule = { ...ten, type: "fixed", value: 50000, productIds: new Set(["ebook"]) };
    const p = priceOrder({ ...base, lines: [tea, ebook], discount: fixed });
    expect(p.discountMinor).toBe(19900);
    expect(p.lines.map((l) => l.discountMinor)).toEqual([0, 19900]);
  });

  it("checks the minimum spend and says why a code doesn't apply", () => {
    const min = { ...ten, minSubtotalMinor: 100000 };
    expect(priceOrder({ ...base, lines: [tea], discount: min }).discount).toBeNull();
    expect(discountProblem(min, [tea], (m) => `₹${m / 100}`)).toBe("Spend ₹1000 or more to use this code");
    expect(discountProblem({ ...ten, productIds: new Set(["mug"]) }, [tea], String)).toBe("This code doesn't apply to anything in your cart");
  });

  it("makes shipping free, counting the saving as the discount", () => {
    const free: DiscountRule = { ...ten, type: "free_shipping", value: 0 };
    const p = priceOrder({ ...base, lines: [tea], discount: free });
    expect(p).toMatchObject({ deliveryMinor: 0, discountMinor: 0, totalMinor: 60000, discount: { type: "free_shipping", amountMinor: 5000 } });
  });

  it("counts discounted value towards free delivery", () => {
    // ₹1,200 of tea is over the ₹1,000 free-delivery mark; 20% off brings it to ₹960, under it.
    expect(priceOrder({ ...base, lines: [{ ...tea, quantity: 4 }], discount: ten }).deliveryMinor).toBe(0);
    const p = priceOrder({ ...base, lines: [{ ...tea, quantity: 4 }], discount: { ...ten, value: 2000 } });
    expect(p.discountMinor).toBe(24000);
    expect(p.deliveryMinor).toBe(5000);
  });
});

describe("buy X get Y", () => {
  const line = (productId: string, unitPriceMinor: number, quantity = 1): PricingLine => ({ productId, productType: "physical", unitPriceMinor, quantity, weightGrams: 100, taxRateBps: null });
  const b2g1: DiscountRule = { id: "b", code: null, title: "Buy 2 get 1 free", type: "buy_x_get_y", value: 10_000, minSubtotalMinor: null, productIds: null, buyXGetY: { buyQuantity: 2, getQuantity: 1, getProductIds: null, maxApplications: null } };

  it("makes the cheapest qualifying item free, and repeats for every full set", () => {
    expect(buyXGetYDiscounts(b2g1, [line("a", 500), line("b", 300), line("c", 100)])).toEqual([0, 0, 100]);
    // Six items: two sets, so the two cheapest are free.
    expect(buyXGetYDiscounts(b2g1, [line("a", 500, 3), line("c", 100, 3)])).toEqual([0, 200]);
    // Two items aren't a set.
    expect(buyXGetYDiscounts(b2g1, [line("a", 500, 2)])).toEqual([0]);
  });

  it("buys from one group and discounts another, never counting an item twice", () => {
    const teaForMug: DiscountRule = { ...b2g1, value: 5000, productIds: new Set(["tea"]), buyXGetY: { buyQuantity: 1, getQuantity: 1, getProductIds: new Set(["mug"]), maxApplications: null } };
    expect(buyXGetYDiscounts(teaForMug, [line("tea", 30000, 2), line("mug", 9900, 3)])).toEqual([0, 9900]);
    // An item in both groups is bought only when nothing else can be: tea (both) is free with a scoop (buy only).
    const either: DiscountRule = { ...b2g1, productIds: new Set(["tea", "scoop"]), buyXGetY: { buyQuantity: 1, getQuantity: 1, getProductIds: new Set(["tea"]), maxApplications: null } };
    expect(buyXGetYDiscounts(either, [line("tea", 8000), line("scoop", 5000)])).toEqual([8000, 0]);
  });

  it("stops at the per-order limit and prices the order with it", () => {
    const once: DiscountRule = { ...b2g1, buyXGetY: { ...b2g1.buyXGetY!, maxApplications: 1 } };
    const lines = [line("a", 500, 6)];
    expect(buyXGetYDiscounts(once, lines)).toEqual([500]);
    const p = priceOrder({ ...base, lines, discount: b2g1 });
    expect(p.discount).toMatchObject({ type: "buy_x_get_y", amountMinor: 1000 });
    expect(p.totalMinor).toBe(3000 - 1000 + 5000);
  });

  it("takes a percentage off instead of making it free, and explains a code that doesn't apply yet", () => {
    expect(buyXGetYDiscounts({ ...b2g1, value: 5000 }, [line("a", 999, 3)])).toEqual([499]);
    expect(priceOrder({ ...base, lines: [line("a", 500)], discount: b2g1 }).discount).toBeNull();
    expect(discountProblem(b2g1, [line("a", 500)], String)).toBe("Add 2 qualifying items and 1 more to your cart to use this code");
    expect(discountProblem(b2g1, [line("a", 500, 3)], String)).toBeUndefined();
  });
});

describe("shipping zones", () => {
  it("matches the most specific zone listed first", () => {
    expect(zoneFor([mumbai, india], { country: "in", postalCode: "400 001" })?.id).toBe("z-mum");
    expect(zoneFor([mumbai, india], { country: "IN", postalCode: "560025" })?.id).toBe("z-in");
    expect(zoneFor([mumbai, india], { country: "US", postalCode: "10001" })).toBeUndefined();
    const kerala: ShippingZone = { ...india, id: "kl", regions: ["Kerala"] };
    expect(zoneFor([kerala], { country: "IN", state: "  kerala " })?.id).toBe("kl");
  });

  it("offers the rates for the parcel, free over a threshold, and honours the chosen one", () => {
    const p = priceOrder({ ...base, lines: [tea], zones: [india], address: { country: "IN", postalCode: "560025" } });
    expect(p.shippingOptions.map((o) => [o.id, o.priceMinor])).toEqual([
      ["std", 6000],
      ["exp", 15000],
    ]);
    expect(p.deliveryMinor).toBe(6000);
    expect(priceOrder({ ...base, lines: [tea], zones: [india], address: { country: "IN", postalCode: "560025" }, rateId: "exp" }).deliveryMinor).toBe(15000);
    const heavy = priceOrder({ ...base, lines: [{ ...tea, quantity: 8 }], zones: [india], address: { country: "IN", postalCode: "560025" } });
    expect(heavy.shippingOptions.map((o) => o.id)).toEqual(["std", "exp", "heavy"]);
    expect(heavy.shippingOptions[0]!.priceMinor).toBe(0);
  });

  it("refuses addresses no zone covers and turns off cash on delivery where the zone does", () => {
    expect(priceOrder({ ...base, lines: [tea], zones: [india], address: { country: "US", postalCode: "10001" } }).deliverable).toBe(false);
    expect(priceOrder({ ...base, lines: [tea], zones: [mumbai, india], address: { country: "IN", postalCode: "400050" } })).toMatchObject({ codAllowed: false, deliveryMinor: 4000 });
  });
});

describe("tax", () => {
  it("works out the GST inside tax-inclusive prices", () => {
    expect(taxOn(11800, 1800, true)).toBe(1800);
    expect(taxOn(10000, 1800, false)).toBe(1800);
    const p = priceOrder({ ...base, deliveryMethod: "none", lines: [tea, ebook], tax: gst });
    expect(p.lines.map((l) => [l.taxRateBps, l.taxMinor])).toEqual([
      [500, 2857],
      [1800, 3036],
    ]);
    expect(p.taxMinor).toBe(5893);
    expect(p.totalMinor).toBe(79900);
  });

  it("adds tax on top when prices exclude it, after discounts, with shipping when asked", () => {
    const vat: TaxSettings = { enabled: true, pricesIncludeTax: false, defaultRateBps: 2000, taxShipping: true, label: "VAT" };
    const p = priceOrder({ ...base, lines: [tea], tax: vat, discount: { id: "d", code: "X", title: "X", type: "fixed", value: 10000, minSubtotalMinor: null, productIds: null } });
    expect(p.taxMinor).toBe(10000 + 1000);
    expect(p.totalMinor).toBe(50000 + 5000 + 11000);
  });
});

describe("booking slots", () => {
  const rules = { hours: DEFAULT_HOURS, durationMinutes: 60, noticeHours: 2, timeZone: "Asia/Kolkata" };

  it("converts wall-clock times in the store's zone", () => {
    expect(zonedTime("2026-11-02", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-11-02T03:30:00.000Z");
    expect(zonedTime("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(localParts(new Date("2026-11-02T03:30:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-11-02", time: "09:00" });
    expect(weekdayOf("2026-11-02")).toBe("mon");
  });

  it("cuts opening hours into slots, respecting notice and closed days", () => {
    const now = new Date("2026-11-02T04:00:00Z"); // 09:30 in Kolkata on a Monday
    const today = slotsOn("2026-11-02", rules, now).map((s) => localParts(s, "Asia/Kolkata").time);
    expect(today).toEqual(["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
    expect(slotsOn("2026-11-08", rules, now)).toEqual([]);
    expect(isSlot(zonedTime("2026-11-03", "10:00", "Asia/Kolkata"), rules, now)).toBe(true);
    expect(isSlot(zonedTime("2026-11-03", "10:30", "Asia/Kolkata"), rules, now)).toBe(false);
  });

  it("checks the hours a merchant enters", () => {
    expect(hoursProblems(DEFAULT_HOURS)).toEqual([]);
    expect(hoursProblems({ ...DEFAULT_HOURS, mon: [["10:00", "09:00"]] })).toEqual(["mon: 10:00–09:00 ends before it starts"]);
    expect(hoursProblems({ ...DEFAULT_HOURS, tue: [["09:00", "13:00"], ["12:00", "18:00"]] })).toEqual(["tue: periods overlap"]);
  });
});
