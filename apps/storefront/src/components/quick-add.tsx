"use client";

import { useState } from "react";
import { CartIcon, CheckIcon } from "@workeasy/ui/react";
import { useCart } from "../lib/cart";

/**
 * "Add to cart" on a product card, for products with a single option in
 * stock. The cart is checked again on the server at checkout, so a price or
 * stock change since the page loaded never goes unnoticed.
 */
export function QuickAdd({
  slug,
  item,
  labels,
}: {
  slug: string;
  item: { variantId: string; title: string; handle: string; imageId: string | null; priceMinor: number };
  labels: { add: string; added: string };
}) {
  const { add } = useCart(slug);
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className="sf-btn sf-btn-block sf-card-add"
      aria-label={`${labels.add}: ${item.title}`}
      onClick={() => {
        add({ variantId: item.variantId, quantity: 1, bookingAt: null, title: item.title, variantTitle: null, handle: item.handle, imageId: item.imageId, priceMinor: item.priceMinor });
        setAdded(true);
        setTimeout(() => setAdded(false), 1600);
      }}
    >
      {added ? <CheckIcon size={16} /> : <CartIcon size={16} />}
      <span aria-live="polite">{added ? labels.added : labels.add}</span>
    </button>
  );
}
