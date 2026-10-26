import { describe, expect, it } from "vitest";
import { chatOrderMessage, deliveryOptions, telegramLink, totals, whatsappLink, type DeliverySettings } from "./checkout";

const settings: DeliverySettings = { deliveryEnabled: true, deliveryFeeMinor: 5000, freeDeliveryOverMinor: 99900, pickupEnabled: true };
const tea = { productType: "physical" as const, unitPriceMinor: 34900, quantity: 2 };
const guide = { productType: "digital" as const, unitPriceMinor: 19900, quantity: 1 };

describe("checkout totals", () => {
  it("charges delivery below the free threshold and nothing at or above it", () => {
    expect(totals([tea], "delivery", settings)).toEqual({ subtotalMinor: 69800, deliveryMinor: 5000, totalMinor: 74800 });
    expect(totals([{ ...tea, quantity: 3 }], "delivery", settings).deliveryMinor).toBe(0);
    expect(totals([tea], "pickup", settings).deliveryMinor).toBe(0);
    expect(totals([tea], "delivery", { ...settings, freeDeliveryOverMinor: null, deliveryFeeMinor: 0 }).deliveryMinor).toBe(0);
  });

  it("offers delivery options only when something physical is in the cart", () => {
    expect(deliveryOptions([guide], settings)).toEqual(["none"]);
    expect(deliveryOptions([guide, tea], settings)).toEqual(["delivery", "pickup"]);
    expect(deliveryOptions([tea], { ...settings, pickupEnabled: false })).toEqual(["delivery"]);
    expect(deliveryOptions([tea], { ...settings, deliveryEnabled: false, pickupEnabled: false })).toEqual([]);
  });
});

describe("chat orders", () => {
  it("writes a readable order message and links", () => {
    const message = chatOrderMessage({
      storeName: "Chai & Co",
      number: 1001,
      currency: "INR",
      lines: [{ title: "Masala Chai", variantTitle: "250 g", quantity: 2, totalMinor: 69800 }, { title: "Tasting", variantTitle: null, quantity: 1, totalMinor: 99900, bookingAt: "Sat 25 Oct, 11:00" }],
      totals: { subtotalMinor: 169700, deliveryMinor: 0, totalMinor: 169700 },
      name: "Ravi",
      phone: "+91 98765 43210",
      deliveryMethod: "delivery",
      address: { line1: "12 MG Road", city: "Pune", state: "MH", postalCode: "411001" },
      note: null,
      orderUrl: "https://shop.example/s/chai/order/abc",
    });
    expect(message).toBe(
      [
        "Hi Chai & Co! I'd like to place order #1001:",
        "",
        "• 2 × Masala Chai (250 g): ₹698",
        "• 1 × Tasting: ₹999, for Sat 25 Oct, 11:00",
        "",
        "Subtotal: ₹1,697",
        "Delivery: Free",
        "Total: ₹1,697",
        "",
        "Name: Ravi",
        "Phone: +91 98765 43210",
        "Deliver to: 12 MG Road, Pune, MH, 411001",
        "",
        "Order details: https://shop.example/s/chai/order/abc",
      ].join("\n"),
    );
    expect(whatsappLink("919876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
    expect(telegramLink("@chaico")).toBe("https://t.me/chaico");
  });
});
