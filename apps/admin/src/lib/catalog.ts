import type { CollectionRules } from "@workeasy/commerce";
import { api } from "./api";

export type { CollectionRules };

/** Catalog shapes as the API returns them (apps/api/src/routes/*). */

export type ProductType = "physical" | "digital" | "service";
export type ProductStatus = "draft" | "active" | "archived";

export interface Variant {
  id: string;
  position: number;
  options: string[];
  sku: string | null;
  barcode: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  costMinor: number | null;
  weightGrams: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  onHand: number;
  reserved: number;
}

export interface Product {
  id: string;
  type: ProductType;
  status: ProductStatus;
  title: string;
  handle: string;
  description: string;
  vendor: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  downloadLimit: number | null;
  downloadExpiryDays: number | null;
  bookingDurationMinutes: number | null;
  bookingNoticeHours: number | null;
  bookingCapacity: number | null;
  bookingHours: Record<string, Array<[string, string]>> | null;
  taxRateBps: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  options: Array<{ name: string; values: string[] }>;
  variants: Variant[];
  mediaIds: string[];
  fileIds: string[];
  collectionIds: string[];
}

export interface ProductSummary {
  id: string;
  type: ProductType;
  status: ProductStatus;
  title: string;
  handle: string;
  vendor: string | null;
  imageId: string | null;
  variantCount: number;
  priceMin: number;
  priceMax: number;
  stock: number | null;
  updatedAt: string;
}

export interface ProductList {
  items: ProductSummary[];
  counts: Record<ProductStatus, number>;
  nextCursor?: string;
}

export type MediaKind = "image" | "video" | "file";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  visibility: "public" | "private";
  status: "uploading" | "scanning" | "ready" | "rejected";
  filename: string;
  contentType: string | null;
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string;
  folder: string;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  usage?: number;
}

export interface Collection {
  id: string;
  title: string;
  handle: string;
  description: string;
  kind: "manual" | "automated";
  rules: CollectionRules | null;
  sortOrder: "manual" | "newest" | "title" | "price_asc" | "price_desc";
  imageId: string | null;
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
  productCount?: number;
}

export interface InventoryRow {
  variantId: string;
  productId: string;
  productTitle: string;
  productStatus: string;
  imageId: string | null;
  options: string[];
  sku: string | null;
  trackInventory: boolean;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number | null;
  updatedAt: string;
}

export interface Movement {
  id: string;
  delta: number;
  onHandAfter: number;
  reason: string;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = { physical: "Physical", digital: "Digital download", service: "Service / booking" };
export const STATUS_LABELS: Record<ProductStatus, string> = { active: "Active", draft: "Draft", archived: "Archived" };
export const STATUS_TONES = { active: "success", draft: "neutral", archived: "warning" } as const;

/** Where the admin and storefront show a public image: a redirect to a signed URL. */
export function mediaUrl(id: string): string {
  return `/public/v1/media/${id}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const REJECT_REASONS: Record<string, string> = {
  infected: "Blocked: the malware scan flagged this file",
  type_not_allowed: "Refused: the file's content isn't an allowed type",
  too_large: "Refused: the file is too large",
  size_mismatch: "Upload was interrupted. Try again",
  missing: "Upload didn't arrive. Try again",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads one file to the Media Library: reserve an upload, send the bytes
 * straight to storage, then ask for the scan. Resolves once the asset is
 * ready or rejected (or after about a minute, still scanning).
 */
export async function uploadMedia(
  storeId: string,
  file: File,
  options: { purpose?: "media" | "file"; folder?: string; onStage?: (stage: "uploading" | "scanning") => void } = {},
): Promise<MediaAsset> {
  const created = await api<{ media: MediaAsset; upload: { url: string; method: string; headers: Record<string, string> } }>(`/api/v1/stores/${storeId}/media/uploads`, {
    method: "POST",
    body: { filename: file.name, contentType: file.type || "application/octet-stream", byteSize: file.size, purpose: options.purpose ?? "media", folder: options.folder ?? "" },
  });
  options.onStage?.("uploading");
  const put = await fetch(created.upload.url, { method: created.upload.method, headers: created.upload.headers, body: file });
  if (!put.ok) throw new Error("The upload didn't reach storage. Check your connection and try again.");
  options.onStage?.("scanning");
  let media = (await api<{ media: MediaAsset }>(`/api/v1/stores/${storeId}/media/${created.media.id}/complete`, { method: "POST" })).media;
  for (let i = 0; i < 40 && media.status === "scanning"; i++) {
    await sleep(i < 5 ? 800 : 1500);
    media = (await api<{ media: MediaAsset }>(`/api/v1/stores/${storeId}/media/${media.id}`)).media;
  }
  return media;
}
