"use client";

import { useSyncExternalStore } from "react";

/**
 * The shopper's cart, kept in this browser per shop. It holds only what was
 * chosen (variant, quantity, booking time) plus a display copy for the
 * header; prices and stock always come fresh from the API at the cart and
 * checkout, so a stale copy can't change what anyone pays.
 */
export interface CartLine {
  variantId: string;
  quantity: number;
  bookingAt: string | null;
  /** Display copy from when it was added. */
  title: string;
  variantTitle: string | null;
  handle: string;
  imageId: string | null;
  priceMinor: number;
}

const key = (slug: string) => `wec-cart:${slug}`;
const EMPTY: CartLine[] = [];
const cache = new Map<string, { raw: string | null; lines: CartLine[] }>();
const listeners = new Set<() => void>();

function read(slug: string): CartLine[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(slug));
  } catch {
    // Storage blocked (private mode): the cart lives for this page only.
  }
  const hit = cache.get(slug);
  if (hit && hit.raw === raw) return hit.lines;
  let lines: CartLine[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) lines = parsed.filter((l): l is CartLine => typeof l?.variantId === "string" && Number.isInteger(l?.quantity) && l.quantity > 0).slice(0, 50);
  } catch {
    lines = EMPTY;
  }
  cache.set(slug, { raw, lines });
  return lines;
}

function write(slug: string, lines: CartLine[]): void {
  const raw = JSON.stringify(lines);
  try {
    localStorage.setItem(key(slug), raw);
  } catch {
    // Keep it in memory only.
  }
  cache.set(slug, { raw, lines });
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed the cart.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const sameLine = (a: Pick<CartLine, "variantId" | "bookingAt">, b: Pick<CartLine, "variantId" | "bookingAt">) => a.variantId === b.variantId && a.bookingAt === b.bookingAt;

export function useCart(slug: string) {
  const lines = useSyncExternalStore(subscribe, () => read(slug), () => EMPTY);
  return {
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    add(line: CartLine, max?: number | null) {
      const current = read(slug);
      const existing = current.find((l) => sameLine(l, line));
      const cap = (q: number) => Math.min(99, max ?? 99, q);
      write(slug, existing ? current.map((l) => (sameLine(l, line) ? { ...l, ...line, quantity: cap(l.quantity + line.quantity) } : l)) : [...current, { ...line, quantity: cap(line.quantity) }]);
    },
    setQuantity(line: Pick<CartLine, "variantId" | "bookingAt">, quantity: number) {
      const current = read(slug);
      write(slug, quantity <= 0 ? current.filter((l) => !sameLine(l, line)) : current.map((l) => (sameLine(l, line) ? { ...l, quantity: Math.min(99, quantity) } : l)));
    },
    remove(line: Pick<CartLine, "variantId" | "bookingAt">) {
      write(slug, read(slug).filter((l) => !sameLine(l, line)));
    },
    clear() {
      write(slug, []);
    },
  };
}
