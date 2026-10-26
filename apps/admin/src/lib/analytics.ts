/** The analytics report as the API returns it (apps/api/src/routes/engagement.ts). */

export interface AnalyticsTotals {
  revenueMinor: number;
  orders: number;
  averageOrderMinor: number;
  visitors: number;
  pageViews: number;
  conversionRate: number | null;
  mobileShare: number | null;
}

export interface AnalyticsReport {
  from: string;
  to: string;
  timeZone: string;
  currency: string;
  series: Array<{ day: string; visitors: number; pageViews: number; productViews: number; viewedProduct: number; addedToCart: number; reachedCheckout: number; orders: number; revenueMinor: number; mobileVisitors: number }>;
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  funnel: { visitors: number; viewedProduct: number; addedToCart: number; reachedCheckout: number; orders: number };
  sources: Array<{ source: string; visitors: number }>;
  topProducts: Array<{ productId: string; title: string; views: number; addedToCart: number; units: number; revenueMinor: number }>;
  customers: { customers: number; returning: number };
}
