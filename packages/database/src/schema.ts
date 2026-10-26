import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

/** Typed view of the `app` schema. Keep in step with migrations/. */
type CreatedAt = ColumnType<Date, never, never>;
type UpdatedAt = ColumnType<Date, never, never>;

export type StoreStatus = "active" | "suspended";
export type MembershipRole = "owner" | "admin" | "staff" | "fulfillment" | "analyst";
export type MembershipStatus = "active" | "revoked";

export interface StoresTable {
  id: string;
  slug: string;
  name: string;
  status: Generated<StoreStatus>;
  currency: Generated<string>;
  country: Generated<string>;
  default_locale: Generated<string>;
  timezone: Generated<string>;
  contact_email: string | null;
  home_region: Generated<string>;
  settings: Generated<Record<string, unknown>>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  custom_domain: string | null;
  domain_token: string | null;
  domain_verified_at: Date | null;
  domain_checked_at: Date | null;
}

export interface UsersTable {
  id: string;
  issuer: string;
  subject: string;
  display_name: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PasswordCredentialsTable {
  user_id: string;
  /** Lower-cased; the identity's subject. */
  email: string;
  password_hash: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface MembershipsTable {
  store_id: string;
  user_id: string;
  role: MembershipRole;
  status: Generated<MembershipStatus>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface InvitationsTable {
  id: Generated<string>;
  store_id: string;
  email: string | null;
  role: MembershipRole;
  token_hash: Buffer;
  created_by: string;
  created_at: CreatedAt;
  expires_at: Date;
  accepted_by: Generated<string | null>;
  accepted_at: Generated<Date | null>;
  revoked_at: Generated<Date | null>;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: CreatedAt;
}

export type ActorType = "user" | "system";

export interface AuditEventsTable {
  id: Generated<string>;
  store_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  request_id: string | null;
  metadata: Generated<Record<string, unknown>>;
  occurred_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: Generated<string>;
  store_id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  trace_id: string | null;
  occurred_at: Generated<Date>;
  dispatched_at: Date | null;
}

export type JobStatus = "queued" | "running" | "succeeded" | "dead";

export interface JobsTable {
  id: Generated<string>;
  store_id: string;
  type: string;
  source_event_id: string | null;
  dedupe_key: string;
  payload: Record<string, unknown>;
  trace_id: string | null;
  status: Generated<JobStatus>;
  attempt: Generated<number>;
  max_attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  lease_until: Date | null;
  lease_token: string | null;
  last_error: string | null;
  created_at: ColumnType<Date, never, never>;
  updated_at: Generated<Date>;
  finished_at: Date | null;
}

export type MediaKind = "image" | "video" | "file";
export type MediaVisibility = "public" | "private";
export type MediaStatus = "uploading" | "scanning" | "ready" | "rejected";

export interface MediaAssetsTable {
  id: Generated<string>;
  store_id: string;
  kind: MediaKind;
  visibility: MediaVisibility;
  status: Generated<MediaStatus>;
  filename: string;
  declared_type: string;
  content_type: string | null;
  byte_size: ColumnType<string, number, number>;
  width: number | null;
  height: number | null;
  alt_text: Generated<string>;
  folder: Generated<string>;
  storage_key: string;
  reject_reason: string | null;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type ProductType = "physical" | "digital" | "service";
export type ProductStatus = "draft" | "active" | "archived";

export interface ProductsTable {
  id: Generated<string>;
  store_id: string;
  type: ProductType;
  status: Generated<ProductStatus>;
  title: string;
  handle: string;
  description: Generated<string>;
  vendor: string | null;
  tags: Generated<string[]>;
  seo_title: string | null;
  seo_description: string | null;
  download_limit: number | null;
  download_expiry_days: number | null;
  booking_duration_minutes: number | null;
  booking_notice_hours: number | null;
  booking_capacity: number | null;
  /** Weekly hours for bookings, {"mon": [["09:00", "18:00"]], ...}; null for the default hours. */
  booking_hours: Record<string, Array<[string, string]>> | null;
  /** Basis points; null for the store's default rate. */
  tax_rate_bps: number | null;
  published_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ProductOptionsTable {
  store_id: string;
  product_id: string;
  position: number;
  name: string;
  values: string[];
}

/** bigint money columns arrive as strings from pg; repositories convert them. */
type Money = ColumnType<string, number, number>;
type NullableMoney = ColumnType<string | null, number | null, number | null>;

export interface VariantsTable {
  id: Generated<string>;
  store_id: string;
  product_id: string;
  position: number;
  options: Generated<string[]>;
  sku: string | null;
  barcode: string | null;
  price_minor: Money;
  compare_at_minor: NullableMoney;
  cost_minor: NullableMoney;
  weight_grams: number | null;
  track_inventory: Generated<boolean>;
  allow_backorder: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ProductMediaTable {
  store_id: string;
  product_id: string;
  media_id: string;
  position: number;
}

export type ProductFilesTable = ProductMediaTable;

export type CollectionKind = "manual" | "automated";
export type CollectionSort = "manual" | "newest" | "title" | "price_asc" | "price_desc";

export interface CollectionsTable {
  id: Generated<string>;
  store_id: string;
  title: string;
  handle: string;
  description: Generated<string>;
  kind: CollectionKind;
  rules: Record<string, unknown> | null;
  sort_order: Generated<CollectionSort>;
  image_media_id: string | null;
  published: Generated<boolean>;
  seo_title: string | null;
  seo_description: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CollectionProductsTable {
  store_id: string;
  collection_id: string;
  product_id: string;
  position: number;
}

export interface InventoryLevelsTable {
  store_id: string;
  variant_id: string;
  on_hand: Generated<number>;
  reserved: Generated<number>;
  low_stock_threshold: number | null;
  updated_at: UpdatedAt;
}

export type MovementReason = "initial" | "received" | "correction" | "damaged" | "returned" | "sold" | "import" | "cancelled";

export interface InventoryMovementsTable {
  id: Generated<string>;
  store_id: string;
  variant_id: string;
  delta: number;
  on_hand_after: number;
  reason: MovementReason;
  note: string | null;
  actor_id: string | null;
  order_id: Generated<string | null>;
  created_at: CreatedAt;
}

export interface CheckoutSettingsTable {
  store_id: string;
  delivery_enabled: Generated<boolean>;
  delivery_fee_minor: ColumnType<string, number | undefined, number>;
  free_delivery_over_minor: ColumnType<string | null, number | null | undefined, number | null>;
  pickup_enabled: Generated<boolean>;
  pickup_address: string | null;
  cod_enabled: Generated<boolean>;
  cod_instructions: string | null;
  bank_enabled: Generated<boolean>;
  bank_instructions: string | null;
  upi_enabled: Generated<boolean>;
  upi_id: string | null;
  upi_instructions: string | null;
  whatsapp_number: string | null;
  telegram_username: string | null;
  order_note_enabled: Generated<boolean>;
  updated_at: UpdatedAt;
}

export interface CustomersTable {
  id: Generated<string>;
  store_id: string;
  email: string;
  name: string;
  phone: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface OrderCountersTable {
  store_id: string;
  last_number: Generated<number>;
}

export type OrderStatus = "open" | "cancelled";
export type PaymentStatus = "pending" | "paid" | "partially_refunded" | "refunded";
export type FulfillmentStatus = "unfulfilled" | "partially_fulfilled" | "fulfilled";
export type OrderPaymentMethod = "cod" | "bank" | "upi" | "whatsapp" | "telegram" | "card";
export type OrderDeliveryMethod = "delivery" | "pickup" | "none";

export interface OrdersTable {
  id: Generated<string>;
  store_id: string;
  number: number;
  token_hash: Buffer;
  status: Generated<OrderStatus>;
  payment_status: Generated<PaymentStatus>;
  fulfillment_status: Generated<FulfillmentStatus>;
  payment_method: OrderPaymentMethod;
  delivery_method: OrderDeliveryMethod;
  customer_id: string;
  email: string;
  name: string;
  phone: string | null;
  shipping_address: Record<string, unknown> | null;
  note: string | null;
  currency: string;
  subtotal_minor: ColumnType<string, number, number>;
  delivery_minor: ColumnType<string, number, number>;
  total_minor: ColumnType<string, number, number>;
  refunded_minor: ColumnType<string, number | undefined, number>;
  payment_due_at: Date | null;
  discount_minor: ColumnType<string, number | undefined, number>;
  discount_code: string | null;
  discount_title: string | null;
  tax_minor: ColumnType<string, number | undefined, number>;
  prices_include_tax: Generated<boolean>;
  tax_label: string | null;
  shipping_rate_name: string | null;
  placed_at: Generated<Date>;
  paid_at: Date | null;
  fulfilled_at: Date | null;
  cancelled_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface OrderItemsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_type: ProductType;
  title: string;
  variant_title: string | null;
  sku: string | null;
  image_media_id: string | null;
  unit_price_minor: ColumnType<string, number, number>;
  quantity: number;
  total_minor: ColumnType<string, number, number>;
  booking_at: Date | null;
  stock_taken: Generated<boolean>;
  position: number;
  discount_minor: ColumnType<string, number | undefined, number>;
  tax_minor: ColumnType<string, number | undefined, number>;
  tax_rate_bps: Generated<number>;
}

export type OrderEventKind = "placed" | "paid" | "fulfilled" | "cancelled" | "note" | "email_sent" | "payment_failed" | "refunded";

export interface OrderEventsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  kind: OrderEventKind;
  message: string;
  actor_id: string | null;
  created_at: CreatedAt;
}

export type GatewayProvider = "razorpay" | "stripe";

export interface PaymentAccountsTable {
  store_id: string;
  provider: GatewayProvider;
  mode: "test" | "live";
  public_key: string;
  secret_key_enc: string;
  webhook_secret_enc: string;
  secret_key_hint: string;
  enabled: Generated<boolean>;
  connected_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PaymentsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  provider: GatewayProvider | "manual";
  provider_ref: string | null;
  provider_payment_id: string | null;
  status: Generated<"created" | "succeeded" | "failed">;
  method: string | null;
  amount_minor: ColumnType<string, number, number>;
  currency: string;
  mode: Generated<"test" | "live">;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface RefundsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  payment_id: string | null;
  amount_minor: ColumnType<string, number, number>;
  currency: string;
  reason: string | null;
  provider_refund_id: string | null;
  status: "pending" | "succeeded" | "failed";
  failure_code: string | null;
  restocked: Generated<boolean>;
  created_by: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface FulfillmentsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  notify_customer: Generated<boolean>;
  created_by: string;
  created_at: CreatedAt;
}

export interface FulfillmentItemsTable {
  store_id: string;
  fulfillment_id: string;
  order_item_id: string;
  quantity: number;
}

export interface WebhookEventsTable {
  store_id: string;
  provider: GatewayProvider;
  event_id: string;
  event_type: string;
  received_at: Generated<Date>;
}

export interface CheckoutsTable {
  id: Generated<string>;
  store_id: string;
  email: string;
  name: string | null;
  phone: string | null;
  items: unknown[];
  subtotal_minor: ColumnType<string, number, number>;
  currency: string;
  order_id: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type DiscountMethod = "code" | "automatic";
export type DiscountKind = "percentage" | "fixed" | "free_shipping" | "buy_x_get_y";

export interface DiscountsTable {
  id: Generated<string>;
  store_id: string;
  method: DiscountMethod;
  code: string | null;
  title: string;
  type: DiscountKind;
  value: ColumnType<string, number, number>;
  min_subtotal_minor: ColumnType<string | null, number | null, number | null>;
  applies_to: Generated<"all" | "collections" | "products">;
  target_ids: Generated<string[]>;
  starts_at: Generated<Date>;
  ends_at: Date | null;
  usage_limit: number | null;
  once_per_customer: Generated<boolean>;
  usage_count: Generated<number>;
  enabled: Generated<boolean>;
  buy_quantity: number | null;
  get_quantity: number | null;
  get_applies_to: "same" | "collections" | "products" | null;
  get_target_ids: Generated<string[]>;
  max_applications: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface DiscountRedemptionsTable {
  store_id: string;
  discount_id: string;
  order_id: string;
  customer_id: string;
  amount_minor: ColumnType<string, number, number>;
  created_at: CreatedAt;
}

export interface ShippingZonesTable {
  id: Generated<string>;
  store_id: string;
  name: string;
  countries: string[];
  regions: Generated<string[]>;
  postal_prefixes: Generated<string[]>;
  cod_enabled: Generated<boolean>;
  position: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ShippingRatesTable {
  id: Generated<string>;
  store_id: string;
  zone_id: string;
  name: string;
  kind: "flat" | "weight" | "price";
  min_value: ColumnType<string | null, number | null, number | null>;
  max_value: ColumnType<string | null, number | null, number | null>;
  price_minor: ColumnType<string, number, number>;
  free_over_minor: ColumnType<string | null, number | null, number | null>;
  delivery_time: string | null;
  position: Generated<number>;
}

export interface TaxSettingsTable {
  store_id: string;
  enabled: Generated<boolean>;
  prices_include_tax: Generated<boolean>;
  default_rate_bps: Generated<number>;
  tax_shipping: Generated<boolean>;
  label: Generated<string>;
  registration_number: string | null;
  updated_at: UpdatedAt;
}

export interface DownloadGrantsTable {
  id: Generated<string>;
  store_id: string;
  order_id: string;
  order_item_id: string;
  media_id: string;
  file_name: string;
  download_limit: number | null;
  downloads_used: Generated<number>;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: CreatedAt;
}

export type ReviewStatus = "pending" | "published" | "hidden";

export interface ReviewsTable {
  id: Generated<string>;
  store_id: string;
  product_id: string;
  order_id: string;
  customer_id: string;
  author_name: string;
  rating: number;
  title: string | null;
  body: Generated<string>;
  status: Generated<ReviewStatus>;
  reply: string | null;
  replied_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ReviewSettingsTable {
  store_id: string;
  auto_publish: Generated<boolean>;
  request_after_days: number | null;
  updated_at: UpdatedAt;
}

export interface ReviewRequestsTable {
  store_id: string;
  order_id: string;
  token_hash: Buffer;
  expires_at: Date;
  created_at: CreatedAt;
}

export type AnalyticsEventType = "page_view" | "product_view" | "add_to_cart" | "checkout_start";

export interface AnalyticsEventsTable {
  id: Generated<string>;
  store_id: string;
  session_id: string;
  type: AnalyticsEventType;
  path: string | null;
  product_id: string | null;
  source: Generated<string>;
  device: Generated<"mobile" | "tablet" | "desktop">;
  created_at: CreatedAt;
}

export interface AnalyticsDailyTable {
  store_id: string;
  day: ColumnType<string, string, string>;
  visitors: number;
  page_views: number;
  product_views: number;
  viewed_product: number;
  added_to_cart: number;
  reached_checkout: number;
  orders: number;
  revenue_minor: ColumnType<string, number, number>;
  mobile_visitors: number;
  updated_at: UpdatedAt;
}

export interface AnalyticsSourcesDailyTable {
  store_id: string;
  day: ColumnType<string, string, string>;
  source: string;
  visitors: number;
}

export interface AnalyticsProductsDailyTable {
  store_id: string;
  day: ColumnType<string, string, string>;
  product_id: string;
  views: number;
  added_to_cart: number;
}

export type AiGenerationStatus = "queued" | "running" | "succeeded" | "failed";

export interface AiGenerationsTable {
  id: Generated<string>;
  store_id: string;
  task: "product_copy" | "collection_copy" | "review_summary" | "sales_insights";
  target_type: "product" | "collection" | null;
  target_id: string | null;
  input: Record<string, unknown>;
  status: Generated<AiGenerationStatus>;
  output: Record<string, unknown> | null;
  error_code: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  created_by: string;
  created_at: CreatedAt;
  finished_at: Date | null;
  applied_at: Date | null;
  applied_by: string | null;
  discarded_at: Date | null;
}

export interface AiUsageDaysTable {
  store_id: string;
  day: ColumnType<string, string, string>;
  generations: Generated<number>;
  tokens: Generated<number>;
}

export interface StoreThemesTable {
  store_id: string;
  draft: Record<string, unknown>;
  published: Record<string, unknown> | null;
  published_at: Date | null;
  updated_by: string | null;
  updated_at: UpdatedAt;
}

export interface StorePagesTable {
  id: Generated<string>;
  store_id: string;
  handle: string;
  title: string;
  body: Generated<string>;
  seo_title: string | null;
  seo_description: string | null;
  published: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface Database {
  stores: StoresTable;
  users: UsersTable;
  password_credentials: PasswordCredentialsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  auth_sessions: AuthSessionsTable;
  audit_events: AuditEventsTable;
  outbox_events: OutboxEventsTable;
  jobs: JobsTable;
  media_assets: MediaAssetsTable;
  products: ProductsTable;
  product_options: ProductOptionsTable;
  variants: VariantsTable;
  product_media: ProductMediaTable;
  product_files: ProductFilesTable;
  collections: CollectionsTable;
  collection_products: CollectionProductsTable;
  inventory_levels: InventoryLevelsTable;
  inventory_movements: InventoryMovementsTable;
  checkout_settings: CheckoutSettingsTable;
  customers: CustomersTable;
  order_counters: OrderCountersTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  order_events: OrderEventsTable;
  payment_accounts: PaymentAccountsTable;
  payments: PaymentsTable;
  refunds: RefundsTable;
  fulfillments: FulfillmentsTable;
  fulfillment_items: FulfillmentItemsTable;
  webhook_events: WebhookEventsTable;
  checkouts: CheckoutsTable;
  discounts: DiscountsTable;
  discount_redemptions: DiscountRedemptionsTable;
  shipping_zones: ShippingZonesTable;
  shipping_rates: ShippingRatesTable;
  tax_settings: TaxSettingsTable;
  download_grants: DownloadGrantsTable;
  reviews: ReviewsTable;
  review_settings: ReviewSettingsTable;
  review_requests: ReviewRequestsTable;
  analytics_events: AnalyticsEventsTable;
  analytics_daily: AnalyticsDailyTable;
  analytics_sources_daily: AnalyticsSourcesDailyTable;
  analytics_products_daily: AnalyticsProductsDailyTable;
  ai_generations: AiGenerationsTable;
  ai_usage_days: AiUsageDaysTable;
  store_themes: StoreThemesTable;
  store_pages: StorePagesTable;
}

export type Store = Selectable<StoresTable>;
export type NewStore = Insertable<StoresTable>;
export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type Membership = Selectable<MembershipsTable>;
export type NewMembership = Insertable<MembershipsTable>;
