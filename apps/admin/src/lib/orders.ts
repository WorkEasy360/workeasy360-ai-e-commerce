/** Order, checkout and money shapes as the API returns them (apps/api/src/routes/orders.ts and money.ts). */

export type PaymentMethod = "card" | "cod" | "bank" | "upi" | "whatsapp" | "telegram";
export type DeliveryMethod = "delivery" | "pickup" | "none";
export type PaymentStatus = "pending" | "paid" | "partially_refunded" | "refunded";
export type FulfillmentStatus = "unfulfilled" | "partially_fulfilled" | "fulfilled";

export interface CheckoutSettings {
  deliveryEnabled: boolean;
  deliveryFeeMinor: number;
  freeDeliveryOverMinor: number | null;
  pickupEnabled: boolean;
  pickupAddress: string | null;
  codEnabled: boolean;
  codInstructions: string | null;
  bankEnabled: boolean;
  bankInstructions: string | null;
  upiEnabled: boolean;
  upiId: string | null;
  upiInstructions: string | null;
  whatsappNumber: string | null;
  telegramUsername: string | null;
  orderNoteEnabled: boolean;
}

export interface OrderSummary {
  id: string;
  number: number;
  name: string;
  email: string;
  status: "open" | "cancelled";
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  totalMinor: number;
  currency: string;
  itemCount: number;
  placedAt: string;
}

export interface Payment {
  id: string;
  provider: "razorpay" | "stripe" | "manual";
  providerRef: string | null;
  providerPaymentId: string | null;
  status: "created" | "succeeded" | "failed";
  method: string | null;
  amountMinor: number;
  currency: string;
  mode: "test" | "live";
  createdAt: string;
}

export interface Refund {
  id: string;
  paymentId: string | null;
  amountMinor: number;
  reason: string | null;
  providerRefundId: string | null;
  status: "pending" | "succeeded" | "failed";
  failureCode: string | null;
  restocked: boolean;
  createdAt: string;
}

export interface Shipment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  items: Array<{ orderItemId: string; quantity: number }>;
  createdAt: string;
}

export interface OrderDetail {
  order: {
    id: string;
    number: number;
    status: "open" | "cancelled";
    paymentStatus: PaymentStatus;
    fulfillmentStatus: FulfillmentStatus;
    paymentMethod: PaymentMethod;
    deliveryMethod: DeliveryMethod;
    email: string;
    name: string;
    phone: string | null;
    address: { line1: string; line2: string | null; city: string; state: string | null; postalCode: string; country: string } | null;
    note: string | null;
    currency: string;
    subtotalMinor: number;
    deliveryMinor: number;
    totalMinor: number;
    refundedMinor: number;
    paymentDueAt: string | null;
    discountMinor: number;
    discountCode: string | null;
    discountTitle: string | null;
    taxMinor: number;
    pricesIncludeTax: boolean;
    taxLabel: string | null;
    shippingRateName: string | null;
    placedAt: string;
    paidAt: string | null;
    fulfilledAt: string | null;
    cancelledAt: string | null;
  };
  items: Array<{
    id: string;
    productId: string | null;
    productType: "physical" | "digital" | "service";
    title: string;
    variantTitle: string | null;
    sku: string | null;
    imageId: string | null;
    unitPriceMinor: number;
    quantity: number;
    totalMinor: number;
    bookingAt: string | null;
    unfulfilledQuantity: number;
    discountMinor: number;
    taxMinor: number;
    taxRateBps: number;
  }>;
  events: Array<{ id: string; kind: string; message: string; actorName: string | null; createdAt: string }>;
  payments: Payment[];
  refunds: Refund[];
  fulfillments: Shipment[];
  refundableMinor: number;
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card: "Online payment",
  cod: "Cash on delivery",
  bank: "Bank transfer",
  upi: "UPI",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export const PROVIDER_LABELS = { razorpay: "Razorpay", stripe: "Stripe", manual: "Recorded by hand" } as const;

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

/** One badge per order: cancelled, then payment, then fulfilment. */
export function orderBadges(o: Pick<OrderSummary, "status" | "paymentStatus" | "fulfillmentStatus">): Array<{ label: string; tone: Tone }> {
  if (o.status === "cancelled") return [{ label: "Cancelled", tone: "neutral" }];
  const payment: Record<PaymentStatus, { label: string; tone: Tone }> = {
    pending: { label: "Payment pending", tone: "warning" },
    paid: { label: "Paid", tone: "success" },
    partially_refunded: { label: "Partly refunded", tone: "info" },
    refunded: { label: "Refunded", tone: "neutral" },
  };
  const fulfilment: Record<FulfillmentStatus, { label: string; tone: Tone }> = {
    unfulfilled: { label: "Unfulfilled", tone: "neutral" },
    partially_fulfilled: { label: "Partly fulfilled", tone: "warning" },
    fulfilled: { label: "Fulfilled", tone: "info" },
  };
  return [payment[o.paymentStatus], fulfilment[o.fulfillmentStatus]];
}
