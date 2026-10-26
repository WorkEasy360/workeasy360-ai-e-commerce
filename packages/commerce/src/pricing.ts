import { needsDelivery, type DeliveryMethod, type DeliverySettings } from "./checkout";

/**
 * Pricing an order: discount, shipping and tax, in that order, on integer
 * minor units. The storefront's running totals and the API's order
 * placement both call priceOrder with the same catalog data, so the shopper
 * always pays exactly what they were shown.
 */

export interface PricingLine {
  productId: string;
  productType: "physical" | "digital" | "service";
  unitPriceMinor: number;
  quantity: number;
  /** Per unit; physical goods only. */
  weightGrams: number;
  /** The product's own tax rate (basis points: 1800 = 18%), or null for the store's default. */
  taxRateBps: number | null;
}

// Discounts -------------------------------------------------------------------------------------

export type DiscountType = "percentage" | "fixed" | "free_shipping" | "buy_x_get_y";

/** Buy X, get Y: what the shopper must buy and what they then get, free or at a percentage off. */
export interface BuyXGetY {
  buyQuantity: number;
  getQuantity: number;
  /** Products the shopper gets; null for the same products they buy (the rule's productIds). */
  getProductIds: ReadonlySet<string> | null;
  /** How many times one order can use it; null for as often as the cart allows. */
  maxApplications: number | null;
}

/** A discount the shopper qualifies to try: a code they entered, or an automatic one. */
export interface DiscountRule {
  id: string;
  /** The code, or null for an automatic discount (shown by title). */
  code: string | null;
  title: string;
  type: DiscountType;
  /** Percentage: basis points (1000 = 10%). Fixed: minor units off. Free shipping: unused. Buy X get Y: basis points off the "get" items (10000 = free). */
  value: number;
  /** Order subtotal needed, before discounts; null for none. */
  minSubtotalMinor: number | null;
  /** Products it applies to (for buy X get Y, the ones to buy); null for every product. */
  productIds: ReadonlySet<string> | null;
  buyXGetY?: BuyXGetY | undefined;
}

export interface AppliedDiscount {
  id: string;
  code: string | null;
  title: string;
  type: DiscountType;
  /** Taken off the items (free shipping takes nothing off them). */
  amountMinor: number;
}

/** Why a code doesn't apply, in words a shopper understands. */
export function discountProblem(rule: DiscountRule, lines: readonly PricingLine[], currencyFormat: (m: number) => string): string | undefined {
  const subtotal = lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0);
  if (rule.minSubtotalMinor !== null && subtotal < rule.minSubtotalMinor) return `Spend ${currencyFormat(rule.minSubtotalMinor)} or more to use this code`;
  if (rule.productIds && !lines.some((l) => rule.productIds!.has(l.productId))) return "This code doesn't apply to anything in your cart";
  if (rule.type === "free_shipping" && !needsDelivery(lines)) return "Nothing in your cart needs shipping";
  if (rule.type === "buy_x_get_y" && rule.buyXGetY && buyXGetYDiscounts(rule, lines).every((d) => d === 0)) {
    const { buyQuantity: x, getQuantity: y } = rule.buyXGetY;
    return `Add ${x} qualifying ${x === 1 ? "item" : "items"} and ${y} more to your cart to use this code`;
  }
  return undefined;
}

/**
 * Buy X get Y, per line: the discount on each line, in minor units. Each use
 * takes X units to buy and Y further units to discount. Units bought are
 * chosen so the offer can apply as often as possible (items that can't be
 * discounted are bought first, then the dearest), and the cheapest
 * qualifying units are the ones discounted, as shoppers expect.
 */
export function buyXGetYDiscounts(rule: DiscountRule, lines: readonly PricingLine[]): number[] {
  const discounts = lines.map(() => 0);
  const offer = rule.buyXGetY;
  if (!offer || offer.buyQuantity < 1 || offer.getQuantity < 1) return discounts;
  const buyIds = rule.productIds;
  const getIds = offer.getProductIds ?? rule.productIds;
  const units = lines.flatMap((l, line) =>
    Array.from({ length: Math.max(0, Math.min(l.quantity, 1000)) }, () => ({
      line,
      price: l.unitPriceMinor,
      canBuy: buyIds === null || buyIds.has(l.productId),
      canGet: getIds === null || getIds.has(l.productId),
    })),
  );
  const toBuy = units.filter((u) => u.canBuy).toSorted((a, b) => Number(a.canGet) - Number(b.canGet) || b.price - a.price || a.line - b.line);
  const toGet = units.filter((u) => u.canGet).toSorted((a, b) => a.price - b.price || a.line - b.line);
  const used = new Set<(typeof units)[number]>();
  const bps = Math.min(10_000, Math.max(0, rule.value));
  for (let uses = 0; offer.maxApplications === null || uses < offer.maxApplications; uses++) {
    const bought = toBuy.filter((u) => !used.has(u)).slice(0, offer.buyQuantity);
    if (bought.length < offer.buyQuantity) break;
    const got = toGet.filter((u) => !used.has(u) && !bought.includes(u)).slice(0, offer.getQuantity);
    if (got.length < offer.getQuantity) break;
    for (const u of [...bought, ...got]) used.add(u);
    for (const u of got) discounts[u.line]! += Math.floor((u.price * bps) / 10_000);
  }
  return discounts;
}

/** Splits `amount` across `weights` in proportion, in whole units, with the remainder to the largest shares. */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).toSorted((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

// Shipping --------------------------------------------------------------------------------------

export interface ShippingRate {
  id: string;
  name: string;
  /** flat: always; weight: when the parcel weighs min–max grams; price: when the subtotal is min–max. */
  kind: "flat" | "weight" | "price";
  minValue: number | null;
  maxValue: number | null;
  priceMinor: number;
  /** Free when the subtotal after discounts reaches this. */
  freeOverMinor: number | null;
  /** "2–4 business days", for the shopper. */
  deliveryTime: string | null;
}

export interface ShippingZone {
  id: string;
  name: string;
  /** ISO 3166 alpha-2 codes. */
  countries: readonly string[];
  /** States or regions, matched case-insensitively; empty for the whole country. */
  regions: readonly string[];
  /** Postal code prefixes; empty for every postal code. */
  postalPrefixes: readonly string[];
  codEnabled: boolean;
  rates: readonly ShippingRate[];
}

export interface ShippingAddress {
  country: string;
  state?: string | null | undefined;
  postalCode?: string | null | undefined;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The first zone (in the merchant's order) that covers the address. */
export function zoneFor(zones: readonly ShippingZone[], address: ShippingAddress): ShippingZone | undefined {
  const country = address.country.toUpperCase();
  const state = address.state ? norm(address.state) : "";
  const postal = (address.postalCode ?? "").replace(/\s+/g, "").toUpperCase();
  return zones.find(
    (z) =>
      z.countries.includes(country) &&
      (z.regions.length === 0 || z.regions.some((r) => norm(r) === state)) &&
      (z.postalPrefixes.length === 0 || z.postalPrefixes.some((p) => postal.startsWith(p.replace(/\s+/g, "").toUpperCase()))),
  );
}

export interface ShippingOption {
  id: string;
  name: string;
  priceMinor: number;
  deliveryTime: string | null;
}

/** The rates that apply to a parcel of this weight and value, cheapest first. */
export function shippingOptions(zone: ShippingZone, weightGrams: number, subtotalAfterDiscountMinor: number): ShippingOption[] {
  return zone.rates
    .filter((r) => {
      const measure = r.kind === "weight" ? weightGrams : r.kind === "price" ? subtotalAfterDiscountMinor : 0;
      return r.kind === "flat" || ((r.minValue === null || measure >= r.minValue) && (r.maxValue === null || measure <= r.maxValue));
    })
    .map((r) => ({ id: r.id, name: r.name, deliveryTime: r.deliveryTime, priceMinor: r.freeOverMinor !== null && subtotalAfterDiscountMinor >= r.freeOverMinor ? 0 : r.priceMinor }))
    .toSorted((a, b) => a.priceMinor - b.priceMinor || a.name.localeCompare(b.name));
}

// Tax -------------------------------------------------------------------------------------------

export interface TaxSettings {
  enabled: boolean;
  /** Prices already include tax (usual in India and the EU): tax is shown, not added. */
  pricesIncludeTax: boolean;
  defaultRateBps: number;
  /** Charge tax on shipping, at the default rate. */
  taxShipping: boolean;
  /** "GST", "VAT" or "Tax". */
  label: string;
}

export const NO_TAX: TaxSettings = { enabled: false, pricesIncludeTax: true, defaultRateBps: 0, taxShipping: false, label: "Tax" };

/** Tax in an amount: for tax-inclusive prices the part that is tax, otherwise what's added on top. */
export function taxOn(amountMinor: number, rateBps: number, inclusive: boolean): number {
  if (amountMinor <= 0 || rateBps <= 0) return 0;
  return inclusive ? Math.round((amountMinor * rateBps) / (10_000 + rateBps)) : Math.round((amountMinor * rateBps) / 10_000);
}

// The whole order -------------------------------------------------------------------------------

export interface PricingInput {
  lines: readonly PricingLine[];
  deliveryMethod: DeliveryMethod;
  /** Needed for zone-based shipping; null before the shopper enters it. */
  address: ShippingAddress | null;
  /** Shipping zones; empty to use the flat fee from checkout settings. */
  zones: readonly ShippingZone[];
  delivery: DeliverySettings;
  /** The shipping rate the shopper picked; the cheapest when absent or no longer offered. */
  rateId?: string | null | undefined;
  discount: DiscountRule | null;
  tax: TaxSettings;
}

export interface PricedOrderLine {
  discountMinor: number;
  taxMinor: number;
  taxRateBps: number;
}

export interface PricedOrder {
  subtotalMinor: number;
  discountMinor: number;
  discount: AppliedDiscount | null;
  /** Delivery charge after any free-shipping discount. */
  deliveryMinor: number;
  shippingOptions: ShippingOption[];
  shippingRate: ShippingOption | null;
  /** Zone-based delivery: false when no zone covers the address (it can't be delivered there). */
  deliverable: boolean;
  /** Cash on delivery allowed for this address (zones can turn it off). */
  codAllowed: boolean;
  taxMinor: number;
  pricesIncludeTax: boolean;
  totalMinor: number;
  lines: PricedOrderLine[];
}

export function priceOrder(input: PricingInput): PricedOrder {
  const { lines, tax } = input;
  const lineTotals = lines.map((l) => l.unitPriceMinor * l.quantity);
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);

  // 1. Discount, spread over the lines it applies to.
  let lineDiscounts = lines.map(() => 0);
  let applied: AppliedDiscount | null = null;
  const rule = input.discount;
  const ruleOk = rule !== null && (rule.minSubtotalMinor === null || subtotal >= rule.minSubtotalMinor);
  if (rule && ruleOk && rule.type === "buy_x_get_y") {
    lineDiscounts = buyXGetYDiscounts(rule, lines);
    const amount = lineDiscounts.reduce((a, b) => a + b, 0);
    if (amount > 0) applied = { id: rule.id, code: rule.code, title: rule.title, type: rule.type, amountMinor: amount };
  } else if (rule && ruleOk) {
    const eligible = lineTotals.map((t, i) => (rule.productIds === null || rule.productIds.has(lines[i]!.productId) ? t : 0));
    const base = eligible.reduce((a, b) => a + b, 0);
    let amount = 0;
    if (rule.type === "percentage") amount = Math.floor((base * Math.min(10_000, Math.max(0, rule.value))) / 10_000);
    else if (rule.type === "fixed") amount = Math.min(base, Math.max(0, rule.value));
    if (base > 0 || rule.type === "free_shipping") {
      lineDiscounts = allocate(amount, eligible);
      applied = { id: rule.id, code: rule.code, title: rule.title, type: rule.type, amountMinor: amount };
    }
  }
  const discountMinor = lineDiscounts.reduce((a, b) => a + b, 0);
  const afterDiscount = subtotal - discountMinor;

  // 2. Shipping.
  let options: ShippingOption[] = [];
  let deliverable = true;
  let codAllowed = true;
  if (input.deliveryMethod === "delivery") {
    if (input.zones.length > 0) {
      const zone = input.address ? zoneFor(input.zones, input.address) : undefined;
      if (input.address && !zone) deliverable = false;
      if (zone) {
        codAllowed = zone.codEnabled;
        const weight = lines.reduce((n, l) => n + (l.productType === "physical" ? l.weightGrams * l.quantity : 0), 0);
        options = shippingOptions(zone, weight, afterDiscount);
        if (options.length === 0) deliverable = false;
      }
    } else {
      const d = input.delivery;
      const free = d.freeDeliveryOverMinor !== null && afterDiscount >= d.freeDeliveryOverMinor;
      options = [{ id: "standard", name: "Standard delivery", priceMinor: free ? 0 : d.deliveryFeeMinor, deliveryTime: null }];
    }
  }
  const rate = options.find((o) => o.id === input.rateId) ?? options[0] ?? null;
  const freeShipping = applied?.type === "free_shipping";
  const deliveryMinor = rate && !freeShipping ? rate.priceMinor : 0;
  if (applied && freeShipping) applied = { ...applied, amountMinor: rate?.priceMinor ?? 0 };

  // 3. Tax on what's actually charged.
  const inclusive = tax.pricesIncludeTax;
  const priced = lines.map((l, i) => {
    const rateBps = tax.enabled ? (l.taxRateBps ?? tax.defaultRateBps) : 0;
    return { discountMinor: lineDiscounts[i]!, taxRateBps: rateBps, taxMinor: tax.enabled ? taxOn(lineTotals[i]! - lineDiscounts[i]!, rateBps, inclusive) : 0 };
  });
  const shippingTax = tax.enabled && tax.taxShipping ? taxOn(deliveryMinor, tax.defaultRateBps, inclusive) : 0;
  const taxMinor = priced.reduce((n, l) => n + l.taxMinor, 0) + shippingTax;

  return {
    subtotalMinor: subtotal,
    discountMinor,
    discount: applied,
    deliveryMinor,
    shippingOptions: options,
    shippingRate: rate,
    deliverable,
    codAllowed,
    taxMinor,
    pricesIncludeTax: inclusive,
    totalMinor: afterDiscount + deliveryMinor + (tax.enabled && !inclusive ? taxMinor : 0),
    lines: priced,
  };
}
