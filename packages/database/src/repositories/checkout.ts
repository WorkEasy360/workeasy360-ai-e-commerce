import type { Selectable, Transaction } from "kysely";
import type { CheckoutSettingsTable, Database } from "../schema.js";

/** A store's checkout options: delivery charges, offline payments and chat ordering. */
type Trx = Transaction<Database>;

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

/** Until a merchant saves anything: free delivery and cash on delivery. */
export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  deliveryEnabled: true,
  deliveryFeeMinor: 0,
  freeDeliveryOverMinor: null,
  pickupEnabled: false,
  pickupAddress: null,
  codEnabled: true,
  codInstructions: null,
  bankEnabled: false,
  bankInstructions: null,
  upiEnabled: false,
  upiId: null,
  upiInstructions: null,
  whatsappNumber: null,
  telegramUsername: null,
  orderNoteEnabled: true,
};

function toSettings(r: Selectable<CheckoutSettingsTable>): CheckoutSettings {
  return {
    deliveryEnabled: r.delivery_enabled,
    deliveryFeeMinor: Number(r.delivery_fee_minor),
    freeDeliveryOverMinor: r.free_delivery_over_minor === null ? null : Number(r.free_delivery_over_minor),
    pickupEnabled: r.pickup_enabled,
    pickupAddress: r.pickup_address,
    codEnabled: r.cod_enabled,
    codInstructions: r.cod_instructions,
    bankEnabled: r.bank_enabled,
    bankInstructions: r.bank_instructions,
    upiEnabled: r.upi_enabled,
    upiId: r.upi_id,
    upiInstructions: r.upi_instructions,
    whatsappNumber: r.whatsapp_number,
    telegramUsername: r.telegram_username,
    orderNoteEnabled: r.order_note_enabled,
  };
}

/** The store's settings, or the defaults if it never saved any. */
export async function getCheckoutSettings(trx: Trx): Promise<CheckoutSettings> {
  const row = await trx.selectFrom("checkout_settings").selectAll().executeTakeFirst();
  return row ? toSettings(row) : DEFAULT_CHECKOUT_SETTINGS;
}

export async function saveCheckoutSettings(trx: Trx, storeId: string, s: CheckoutSettings): Promise<CheckoutSettings> {
  const values = {
    delivery_enabled: s.deliveryEnabled,
    delivery_fee_minor: s.deliveryFeeMinor,
    free_delivery_over_minor: s.freeDeliveryOverMinor,
    pickup_enabled: s.pickupEnabled,
    pickup_address: s.pickupAddress,
    cod_enabled: s.codEnabled,
    cod_instructions: s.codInstructions,
    bank_enabled: s.bankEnabled,
    bank_instructions: s.bankInstructions,
    upi_enabled: s.upiEnabled,
    upi_id: s.upiId,
    upi_instructions: s.upiInstructions,
    whatsapp_number: s.whatsappNumber,
    telegram_username: s.telegramUsername,
    order_note_enabled: s.orderNoteEnabled,
  };
  const row = await trx
    .insertInto("checkout_settings")
    .values({ store_id: storeId, ...values })
    .onConflict((oc) => oc.column("store_id").doUpdateSet(values))
    .returningAll()
    .executeTakeFirstOrThrow();
  return toSettings(row);
}

/** Payment methods shoppers can choose, in the order the storefront offers them. */
export function enabledPaymentMethods(s: CheckoutSettings): Array<"cod" | "bank" | "upi" | "whatsapp" | "telegram"> {
  const methods: Array<"cod" | "bank" | "upi" | "whatsapp" | "telegram"> = [];
  if (s.whatsappNumber) methods.push("whatsapp");
  if (s.telegramUsername) methods.push("telegram");
  if (s.upiEnabled && s.upiId) methods.push("upi");
  if (s.bankEnabled && s.bankInstructions) methods.push("bank");
  if (s.codEnabled) methods.push("cod");
  return methods;
}
