import { MAX_MINOR } from "@workeasy/commerce";
import { z } from "zod";

/** Request schemas for the storefront cart and checkout, checkout settings and the Orders module. */

const Uuid = z.uuid();
const Money = z.number().int().min(0).max(MAX_MINOR);
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const CartItem = z.object({
  variantId: Uuid,
  quantity: z.number().int().min(1).max(99),
  bookingAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

const DiscountCode = z
  .string()
  .trim()
  .toUpperCase()
  .max(32)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

/** Where the parcel goes, as far as shipping needs to know before the full address. */
const QuoteAddress = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  state: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(12).nullable().optional(),
});

export const CartBodySchema = z.object({
  items: z.array(CartItem).max(50),
  deliveryMethod: z.enum(["delivery", "pickup", "none"]).optional(),
  address: QuoteAddress.nullable().optional(),
  rateId: z.string().max(64).nullable().optional(),
  discountCode: DiscountCode,
  email: z.email().trim().toLowerCase().max(254).nullable().optional().or(z.literal("").transform(() => null)),
});

const Address = z.object({
  line1: z.string().trim().min(1, "Enter your street address").max(200),
  line2: OptionalText(200),
  city: z.string().trim().min(1, "Enter your city").max(100),
  state: OptionalText(100),
  postalCode: z.string().trim().min(3, "Enter your postal code").max(12).regex(/^[A-Za-z0-9 -]+$/, "Enter a valid postal code"),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
});

export const PlaceOrderBodySchema = z
  .object({
    items: z.array(CartItem).min(1, "Your cart is empty").max(50),
    email: z.email("Enter a valid email").trim().toLowerCase().max(254),
    name: z.string().trim().min(1, "Enter your name").max(200),
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[+0-9 ()-]*$/, "Enter a valid phone number")
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    deliveryMethod: z.enum(["delivery", "pickup", "none"]),
    address: Address.nullable().optional(),
    paymentMethod: z.enum(["cod", "bank", "upi", "whatsapp", "telegram", "card"]),
    note: OptionalText(1000),
    /** The shopper's saved checkout, so it stops counting as abandoned. */
    checkoutId: Uuid.optional(),
    discountCode: DiscountCode,
    rateId: z.string().max(64).nullable().optional(),
  })
  .superRefine((o, ctx) => {
    if (o.deliveryMethod === "delivery" && !o.address) ctx.addIssue({ code: "custom", path: ["address"], message: "Enter a delivery address" });
    if ((o.paymentMethod === "whatsapp" || o.paymentMethod === "cod") && !o.phone) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a phone number so the shop can reach you" });
    }
  });

export const CheckoutSettingsBodySchema = z
  .object({
    deliveryEnabled: z.boolean(),
    deliveryFeeMinor: Money,
    freeDeliveryOverMinor: Money.nullable(),
    pickupEnabled: z.boolean(),
    pickupAddress: OptionalText(500),
    codEnabled: z.boolean(),
    codInstructions: OptionalText(1000),
    bankEnabled: z.boolean(),
    bankInstructions: OptionalText(2000),
    upiEnabled: z.boolean(),
    upiId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,64}$/, "Enter a UPI ID such as shop@upi")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null))
      .transform((v) => v ?? null),
    upiInstructions: OptionalText(1000),
    whatsappNumber: z
      .string()
      .transform((v) => v.replace(/[\s()+-]/g, ""))
      .pipe(z.string().regex(/^([1-9][0-9]{7,14})?$/, "Enter the number with country code, such as 91 98765 43210"))
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    telegramUsername: z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, ""))
      .pipe(z.string().regex(/^([A-Za-z][A-Za-z0-9_]{4,31})?$/, "Enter a Telegram username of 5 to 32 letters, numbers or underscores"))
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    orderNoteEnabled: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (s.bankEnabled && !s.bankInstructions) ctx.addIssue({ code: "custom", path: ["bankInstructions"], message: "Add your bank details for shoppers" });
    if (s.upiEnabled && !s.upiId) ctx.addIssue({ code: "custom", path: ["upiId"], message: "Add your UPI ID" });
    if (s.pickupEnabled && !s.pickupAddress) ctx.addIssue({ code: "custom", path: ["pickupAddress"], message: "Add the pickup address" });
  });

export const OrderListQuerySchema = z.object({
  tab: z.enum(["all", "unpaid", "unfulfilled", "cancelled"]).default("all"),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
});

export const CancelOrderBodySchema = z.object({ restock: z.boolean().default(true) });
export const OrderNoteBodySchema = z.object({ note: z.string().trim().min(1, "Write a note").max(1000) });
