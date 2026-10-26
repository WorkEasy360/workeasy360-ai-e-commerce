import { parseCsv, toCsv } from "./csv";
import { isHandle } from "./handle";
import { parseMoney, toDecimalString } from "./money";
import { MAX_OPTIONS, MAX_VARIANTS, optionProblems, variantKey, type ProductOption } from "./variants";

/**
 * The product spreadsheet: one row per variant. Product columns (title,
 * description…) are read from a product's first row and may be left blank on
 * the rows after it. Handles tie rows to products, so importing a file you
 * exported updates those products instead of duplicating them.
 */
export const PRODUCT_CSV_COLUMNS = [
  "Handle",
  "Title",
  "Type",
  "Status",
  "Description",
  "Vendor",
  "Tags",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "SKU",
  "Barcode",
  "Price",
  "Compare At Price",
  "Cost",
  "Weight (g)",
  "Stock",
  "Track Stock",
  "SEO Title",
  "SEO Description",
] as const;

export type ProductType = "physical" | "digital" | "service";
export type ProductStatus = "draft" | "active" | "archived";
const TYPES: readonly ProductType[] = ["physical", "digital", "service"];
const STATUSES: readonly ProductStatus[] = ["draft", "active", "archived"];

export interface CsvVariant {
  options: string[];
  sku: string | null;
  barcode: string | null;
  priceMinor: number;
  compareAtMinor: number | null;
  costMinor: number | null;
  weightGrams: number | null;
  /** Null: leave the current stock as it is. */
  stock: number | null;
  trackInventory: boolean;
}

export interface CsvProduct {
  handle: string;
  title: string;
  type: ProductType;
  status: ProductStatus;
  description: string;
  vendor: string | null;
  tags: string[];
  options: ProductOption[];
  seoTitle: string | null;
  seoDescription: string | null;
  variants: CsvVariant[];
}

export interface CsvProblem {
  /** Spreadsheet row number: the header is row 1. */
  row: number;
  message: string;
}

export const MAX_IMPORT_ROWS = 5000;

export function productsToCsv(products: readonly CsvProduct[], currency: string): string {
  const rows: (string | number | null)[][] = [[...PRODUCT_CSV_COLUMNS]];
  for (const p of products) {
    p.variants.forEach((v, i) => {
      const first = i === 0;
      const opt = (n: number) => [first ? (p.options[n]?.name ?? "") : "", v.options[n] ?? ""];
      rows.push([
        p.handle,
        first ? p.title : "",
        first ? p.type : "",
        first ? p.status : "",
        first ? p.description : "",
        first ? (p.vendor ?? "") : "",
        first ? p.tags.join(", ") : "",
        ...opt(0),
        ...opt(1),
        ...opt(2),
        v.sku ?? "",
        v.barcode ?? "",
        toDecimalString(v.priceMinor, currency),
        v.compareAtMinor == null ? "" : toDecimalString(v.compareAtMinor, currency),
        v.costMinor == null ? "" : toDecimalString(v.costMinor, currency),
        v.weightGrams ?? "",
        v.stock ?? "",
        v.trackInventory ? "true" : "false",
        first ? (p.seoTitle ?? "") : "",
        first ? (p.seoDescription ?? "") : "",
      ]);
    });
  }
  return toCsv(rows);
}

function parseBool(value: string, fallback: boolean): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return undefined;
}

function parseCount(value: string): number | null | undefined {
  const v = value.trim();
  if (v === "") return null;
  if (!/^-?\d{1,9}$/.test(v)) return undefined;
  return Number(v);
}

/**
 * Reads a product spreadsheet. Every problem is reported with its row, and
 * a product with any problem is left out of `products`, so a preview can
 * show exactly what would and would not be imported.
 */
export function parseProductCsv(text: string, currency: string): { products: CsvProduct[]; problems: CsvProblem[] } {
  const problems: CsvProblem[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) return { products: [], problems: [{ row: 1, message: "The file is empty" }] };
  if (rows.length - 1 > MAX_IMPORT_ROWS) return { products: [], problems: [{ row: 1, message: `Import at most ${MAX_IMPORT_ROWS} rows at a time` }] };

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: (typeof PRODUCT_CSV_COLUMNS)[number]) => header.indexOf(name.toLowerCase());
  for (const required of ["Handle", "Title", "Price"] as const) {
    if (col(required) < 0) problems.push({ row: 1, message: `Missing the "${required}" column` });
  }
  if (problems.length > 0) return { products: [], problems };

  const groups = new Map<string, { rows: { n: number; get: (c: (typeof PRODUCT_CSV_COLUMNS)[number]) => string }[] }>();
  rows.slice(1).forEach((cells, i) => {
    const n = i + 2;
    const get = (c: (typeof PRODUCT_CSV_COLUMNS)[number]) => {
      const idx = col(c);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    // Exports guard formula-like text with a leading apostrophe; strip it on the way back in.
    const getClean = (c: (typeof PRODUCT_CSV_COLUMNS)[number]) => get(c).replace(/^'(?=[=+\-@])/, "");
    const handle = get("Handle").toLowerCase();
    if (!handle) {
      problems.push({ row: n, message: "Handle is empty" });
      return;
    }
    const group = groups.get(handle) ?? { rows: [] };
    group.rows.push({ n, get: getClean });
    groups.set(handle, group);
  });

  const products: CsvProduct[] = [];
  for (const [handle, group] of groups) {
    const before = problems.length;
    const first = group.rows[0]!;
    const fail = (row: number, message: string) => problems.push({ row, message });
    if (!isHandle(handle)) fail(first.n, `"${handle}" is not a valid handle: use lowercase letters, numbers and hyphens`);
    const title = first.get("Title");
    if (!title) fail(first.n, "Title is empty");
    if (title.length > 200) fail(first.n, "Title is longer than 200 characters");
    const type = (first.get("Type").toLowerCase() || "physical") as ProductType;
    if (!TYPES.includes(type)) fail(first.n, `Type must be one of ${TYPES.join(", ")}`);
    const status = (first.get("Status").toLowerCase() || "draft") as ProductStatus;
    if (!STATUSES.includes(status)) fail(first.n, `Status must be one of ${STATUSES.join(", ")}`);

    const optionNames = [first.get("Option1 Name"), first.get("Option2 Name"), first.get("Option3 Name")];
    const optionCount = optionNames.reduce((n, name, i) => (name ? i + 1 : n), 0);
    if (optionNames.slice(0, optionCount).some((name) => !name)) fail(first.n, "Option names must be filled in order: Option1, then Option2, then Option3");
    const options: ProductOption[] = optionNames.slice(0, Math.min(optionCount, MAX_OPTIONS)).map((name) => ({ name, values: [] }));

    const seen = new Set<string>();
    const variants: CsvVariant[] = [];
    for (const r of group.rows) {
      const values = [r.get("Option1 Value"), r.get("Option2 Value"), r.get("Option3 Value")].slice(0, optionCount);
      if (values.some((v) => !v)) {
        fail(r.n, "Fill in a value for every option");
        continue;
      }
      values.forEach((v, i) => {
        if (!options[i]!.values.some((x) => x.toLowerCase() === v.toLowerCase())) options[i]!.values.push(v);
      });
      const key = variantKey(values);
      if (seen.has(key)) fail(r.n, `The variant ${values.join(" / ") || "(default)"} appears twice`);
      seen.add(key);

      const price = parseMoney(r.get("Price"), currency);
      if (price === undefined) fail(r.n, "Price must be an amount such as 499 or 499.50");
      const money = (c: "Compare At Price" | "Cost") => {
        const raw = r.get(c);
        if (!raw) return null;
        const v = parseMoney(raw, currency);
        if (v === undefined) fail(r.n, `${c} must be an amount`);
        return v ?? null;
      };
      const compareAt = money("Compare At Price");
      const cost = money("Cost");
      const weight = parseCount(r.get("Weight (g)"));
      if (weight === undefined || (weight !== null && weight < 0)) fail(r.n, "Weight must be a whole number of grams");
      const stock = parseCount(r.get("Stock"));
      if (stock === undefined) fail(r.n, "Stock must be a whole number");
      const track = parseBool(r.get("Track Stock"), type === "physical");
      if (track === undefined) fail(r.n, "Track Stock must be true or false");
      variants.push({
        options: values,
        sku: r.get("SKU") || null,
        barcode: r.get("Barcode") || null,
        priceMinor: price ?? 0,
        compareAtMinor: compareAt,
        costMinor: cost,
        weightGrams: weight ?? null,
        stock: stock ?? null,
        trackInventory: track ?? true,
      });
    }
    if (variants.length > MAX_VARIANTS) fail(first.n, `A product can have at most ${MAX_VARIANTS} variants`);
    for (const message of optionProblems(options)) fail(first.n, message);

    if (problems.length === before) {
      products.push({
        handle,
        title,
        type,
        status,
        description: first.get("Description"),
        vendor: first.get("Vendor") || null,
        tags: first
          .get("Tags")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 50),
        options,
        seoTitle: first.get("SEO Title") || null,
        seoDescription: first.get("SEO Description") || null,
        variants,
      });
    }
  }
  return { products, problems: problems.toSorted((a, b) => a.row - b.row) };
}
