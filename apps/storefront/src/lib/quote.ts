"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "./cart";
import type { CheckoutOptions, DeliveryMethod } from "./stores";

/** A cart priced by the API: current prices, stock problems, delivery choices and totals. */
export interface Quote {
  lines: Array<{
    variantId: string;
    quantity: number;
    bookingAt?: string | null;
    problem?: string;
    title?: string;
    variantTitle?: string | null;
    handle?: string;
    imageId?: string | null;
    priceMinor?: number;
    totalMinor?: number;
    type?: "physical" | "digital" | "service";
    maxQuantity?: number | null;
  }>;
  deliveryOptions: DeliveryMethod[];
  totals: Partial<Record<DeliveryMethod, { subtotalMinor: number; discountMinor: number; deliveryMinor: number; taxMinor: number; totalMinor: number }>>;
  /** The full breakdown for the delivery method asked about (or the first one). */
  pricing: Pricing | null;
  checkout: CheckoutOptions;
  currency: string;
}

export interface Pricing {
  deliveryMethod: DeliveryMethod;
  subtotalMinor: number;
  discountMinor: number;
  discount: { code: string | null; title: string; type: "percentage" | "fixed" | "free_shipping" | "buy_x_get_y"; amountMinor: number } | null;
  discountError: string | null;
  deliveryMinor: number;
  shippingOptions: Array<{ id: string; name: string; priceMinor: number; deliveryTime: string | null }>;
  shippingRateId: string | null;
  shippingNeedsAddress: boolean;
  deliverable: boolean;
  codAllowed: boolean;
  taxMinor: number;
  taxLabel: string | null;
  pricesIncludeTax: boolean;
  totalMinor: number;
}

/** What checkout knows so far that changes the price. */
export interface QuoteContext {
  deliveryMethod?: DeliveryMethod | undefined;
  address?: { country: string; state?: string | null; postalCode?: string | null } | null;
  rateId?: string | null;
  discountCode?: string | null;
  email?: string | null;
}

/** Re-prices the cart whenever it changes; `error` when the shop can't be reached. */
export function useQuote(slug: string, lines: CartLine[], context: QuoteContext = {}): { quote: Quote | undefined; error: boolean } {
  const [state, setState] = useState<{ key: string; quote?: Quote; error: boolean }>({ key: "", error: false });
  const key = JSON.stringify({ items: lines.map((l) => [l.variantId, l.quantity, l.bookingAt]), context });

  useEffect(() => {
    let cancelled = false;
    const parsed = JSON.parse(key) as { items: Array<[string, number, string | null]>; context: QuoteContext };
    const items = parsed.items.map(([variantId, quantity, bookingAt]) => ({ variantId, quantity, bookingAt }));
    const timer = setTimeout(() => {
      fetch(`/public/v1/stores/${slug}/cart`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ items, ...parsed.context }) })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const quote = (await res.json()) as Quote;
          if (!cancelled) setState({ key, quote, error: false });
        })
        .catch(() => {
          if (!cancelled) setState({ key, error: true });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, key]);

  // A quote for an older cart is still shown while the new one loads, so totals don't flicker.
  return { quote: state.quote, error: state.error && state.key === key };
}
