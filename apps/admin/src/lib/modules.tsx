import type { ReactNode } from "react";
import {
  AnalyticsIcon,
  CollectionIcon,
  DashboardIcon,
  DesignIcon,
  InventoryIcon,
  MediaIcon,
  OfferIcon,
  OrderIcon,
  PaymentIcon,
  ProductIcon,
  ReviewIcon,
  SettingsIcon,
  ShippingIcon,
  SparkleIcon,
} from "@workeasy/ui/react";

/**
 * The fourteen admin modules, in sidebar order. The sidebar, the page
 * headers and the not-yet-built module pages all read from this one list,
 * so names, icons, permissions and descriptions never drift apart.
 */
export type ModuleKey =
  | "dashboard"
  | "products"
  | "collections"
  | "inventory"
  | "media"
  | "orders"
  | "offers"
  | "reviews"
  | "shipping"
  | "payments"
  | "analytics"
  | "design"
  | "ai"
  | "settings";

export type ModuleGroup = "Overview" | "Catalog" | "Sales" | "Operations" | "Growth" | "Store";

export interface AdminModule {
  key: ModuleKey;
  label: string;
  /** Path under /s/<storeId>; "" is the dashboard. */
  path: string;
  group: ModuleGroup;
  icon: (size?: number) => ReactNode;
  /** Shown in the sidebar only to roles holding it; the API enforces it again. */
  permission?: string;
  /** One line under the page title. */
  summary: string;
  /** What the module does, for its page and empty state. */
  features: readonly string[];
  /** The primary action in the page header. */
  primaryAction?: string;
  /** Build phase (docs/03-roadmap.md); undefined once it is live. */
  phase?: number;
}

export const MODULES: readonly AdminModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "",
    group: "Overview",
    icon: (s) => <DashboardIcon size={s} />,
    summary: "How your store is doing today, and what to do next.",
    features: [],
  },
  {
    key: "products",
    label: "Products",
    path: "/products",
    group: "Catalog",
    icon: (s) => <ProductIcon size={s} />,
    permission: "products.read",
    summary: "Physical goods, digital downloads and bookable services, with variants.",
    primaryAction: "Add product",
    features: [
      "Physical, digital and service (booking) products",
      "Variants: size, colour or any option, each with its own price, SKU and stock",
      "Photos and video from the Media Library",
      "Draft, active and archived states",
      "SEO title, description and URL",
      "CSV import, export and bulk edit",
    ],
  },
  {
    key: "collections",
    label: "Collections",
    path: "/collections",
    group: "Catalog",
    icon: (s) => <CollectionIcon size={s} />,
    permission: "products.read",
    summary: "Group products for your storefront's menus and pages.",
    primaryAction: "Create collection",
    features: [
      "Manual collections you curate product by product",
      "Automated collections from rules: tag, price, type",
      "Custom sort order, image and description",
      "SEO for every collection page",
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    path: "/inventory",
    group: "Catalog",
    icon: (s) => <InventoryIcon size={s} />,
    permission: "inventory.read",
    summary: "Stock for every variant, with a full history of changes.",
    primaryAction: "Adjust stock",
    features: [
      "Per-variant stock levels",
      "Adjustments with a reason, kept as a ledger",
      "Low-stock thresholds and alerts",
      "Stock held for shoppers at checkout",
      "Capacity for bookable services",
    ],
  },
  {
    key: "media",
    label: "Media Library",
    path: "/media",
    group: "Catalog",
    icon: (s) => <MediaIcon size={s} />,
    permission: "media.manage",
    summary: "Every image, video and file your store uses, in one place.",
    primaryAction: "Upload",
    features: [
      "Direct uploads, scanned for malware",
      "Folders, tags and alt text",
      "See where each file is used",
      "Resized images for fast pages",
    ],
  },
  {
    key: "orders",
    label: "Orders",
    path: "/orders",
    group: "Sales",
    icon: (s) => <OrderIcon size={s} />,
    permission: "orders.read",
    summary: "Every order from your storefront: paid online, on WhatsApp, by UPI, bank transfer or cash on delivery.",
    features: [
      "Status tabs: unpaid, to fulfil, shipped, completed",
      "Timeline of payments, fulfilment and notes",
      "Mark chat and offline orders as paid",
      "Partial fulfilment and refunds",
      "PDF invoices",
      "Customers and abandoned checkouts",
    ],
  },
  {
    key: "offers",
    label: "Offers",
    path: "/offers",
    group: "Sales",
    icon: (s) => <OfferIcon size={s} />,
    permission: "offers.manage",
    summary: "Discount codes and automatic deals.",
    primaryAction: "Create offer",
    features: [
      "Percentage, fixed amount and free shipping",
      "Codes or automatic discounts",
      "Minimum order, usage limits and schedules",
      "Redemption reporting",
    ],
  },
  {
    key: "reviews",
    label: "Reviews",
    path: "/reviews",
    group: "Sales",
    icon: (s) => <ReviewIcon size={s} />,
    permission: "reviews.manage",
    summary: "Ratings from buyers. You decide what goes live.",
    features: ["Moderation queue: publish, hide or reply", "Ratings summary per product", "Review requests emailed after delivery"],
  },
  {
    key: "shipping",
    label: "Shipping",
    path: "/shipping",
    group: "Operations",
    icon: (s) => <ShippingIcon size={s} />,
    permission: "shipping.manage",
    summary: "Where you deliver, what it costs, and local pickup.",
    primaryAction: "Add shipping zone",
    features: [
      "Shipping zones by country, state or PIN code",
      "Flat, weight-based and price-based rates",
      "Free shipping above an order value",
      "Local pickup",
      "Cash on delivery per zone",
    ],
  },
  {
    key: "payments",
    label: "Payments & Finances",
    path: "/payments",
    group: "Operations",
    icon: (s) => <PaymentIcon size={s} />,
    permission: "finances.read",
    summary: "How shoppers pay you, and every rupee that moves.",
    features: [
      "Razorpay (UPI, cards, netbanking) and Stripe",
      "WhatsApp and Telegram chat checkout",
      "Bank transfer, UPI and cash on delivery with your instructions",
      "Transactions, payouts and refunds",
      "Taxes: GST and VAT",
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    path: "/analytics",
    group: "Growth",
    icon: (s) => <AnalyticsIcon size={s} />,
    permission: "analytics.read",
    summary: "Sales, visitors and what turns them into buyers.",
    features: [
      "Sales, orders and average order value",
      "Visits and traffic sources",
      "Conversion funnel from visit to purchase",
      "Top products and repeat buyers",
      "Date ranges and CSV export",
    ],
  },
  {
    key: "design",
    label: "Store Design",
    path: "/design",
    group: "Growth",
    icon: (s) => <DesignIcon size={s} />,
    permission: "design.manage",
    summary: "Your storefront's look, pages and menus, with a live preview.",
    primaryAction: "Customize",
    features: [
      "Section-based home page: hero, product grid, banners, testimonials, FAQ",
      "Live preview on desktop and mobile",
      "Colours, fonts and logo",
      "Navigation menus",
      "Storefront in English, Hindi and Arabic, with automatic detection",
    ],
  },
  {
    key: "ai",
    label: "AI Studio",
    path: "/ai",
    group: "Growth",
    icon: (s) => <SparkleIcon size={s} />,
    permission: "ai.use",
    summary: "Write, translate and set up faster. Nothing changes until you apply it.",
    primaryAction: "New generation",
    features: ["Product descriptions, SEO and tags", "Collection copy", "Review summaries and sales insights", "Thirteen languages"],
  },
  {
    key: "settings",
    label: "Settings",
    path: "/settings",
    group: "Store",
    icon: (s) => <SettingsIcon size={s} />,
    permission: "settings.manage",
    summary: "Store details, staff, checkout and notifications.",
    features: [],
  },
];

export const MODULE_GROUPS: readonly ModuleGroup[] = ["Overview", "Catalog", "Sales", "Operations", "Growth", "Store"];

export function moduleByKey(key: ModuleKey): AdminModule {
  const found = MODULES.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown module ${key}`);
  return found;
}
