import { minorDigits } from "@workeasy/commerce";
import type { Order, OrderItem } from "@workeasy/database";

/**
 * Order invoices as PDF, written directly: A4 pages of text in the standard
 * Helvetica fonts, which every PDF reader has, so there is nothing to embed
 * or install. Those fonts cover Latin-1 only, so amounts show the currency
 * code (INR 1,250.00) and other characters are transliterated or replaced.
 */
export interface InvoiceStore {
  name: string;
  contactEmail: string | null;
  /** GSTIN or VAT number, when the store charges tax. */
  taxRegistration?: string | null;
  timezone: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const LINE = 16;

type Cell = { text: string; x: number; size?: number; bold?: boolean; right?: boolean; color?: [number, number, number] };

/** Latin-1 text for the standard fonts: common typography mapped, the rest replaced. */
function latin1(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/[  ]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function pdfString(text: string): string {
  return `(${latin1(text).replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** Approximate Helvetica width, enough to right-align numbers. */
function widthOf(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const ch of text) units += /[0-9]/.test(ch) ? 556 : /[.,: ]/.test(ch) ? 278 : /[A-Z]/.test(ch) ? 667 : /[il|'!]/.test(ch) ? 222 : 556;
  return (units * size * (bold ? 1.05 : 1)) / 1000;
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 10 ** minorDigits(currency)).replace(/\s+/g, " ");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function invoicePdf(order: Order, items: OrderItem[], store: InvoiceStore): Buffer {
  const date = (d: Date) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: store.timezone }).format(d);
  const rows: Cell[][] = [];
  const gap = () => rows.push([]);

  rows.push([{ text: store.name, x: MARGIN, size: 18, bold: true, color: [0.027, 0.11, 0.27] }, { text: "INVOICE", x: PAGE_W - MARGIN, size: 18, bold: true, right: true, color: [0.07, 0.34, 0.78] }]);
  if (store.contactEmail) rows.push([{ text: store.contactEmail, x: MARGIN, size: 10 }]);
  if (store.taxRegistration && order.taxLabel) rows.push([{ text: `${order.taxLabel === "GST" ? "GSTIN" : `${order.taxLabel} no.`} ${store.taxRegistration}`, x: MARGIN, size: 10 }]);
  gap();
  rows.push([{ text: `Invoice for order #${order.number}`, x: MARGIN, bold: true }, { text: `Date: ${date(order.placedAt)}`, x: PAGE_W - MARGIN, right: true }]);
  rows.push([{ text: `Payment: ${order.paymentStatus.replace("_", " ")}`, x: MARGIN }, ...(order.paidAt ? [{ text: `Paid: ${date(order.paidAt)}`, x: PAGE_W - MARGIN, right: true }] : [])]);
  gap();
  rows.push([{ text: "Bill to", x: MARGIN, bold: true }]);
  rows.push([{ text: order.name, x: MARGIN }]);
  rows.push([{ text: order.email, x: MARGIN }]);
  if (order.phone) rows.push([{ text: order.phone, x: MARGIN }]);
  if (order.deliveryMethod === "delivery" && order.address) {
    const a = order.address;
    rows.push([{ text: a.line1, x: MARGIN }]);
    if (a.line2) rows.push([{ text: a.line2, x: MARGIN }]);
    rows.push([{ text: [a.city, a.state, a.postalCode].filter(Boolean).join(", "), x: MARGIN }]);
  }
  gap();
  const qtyX = 360;
  const priceX = 450;
  const totalX = PAGE_W - MARGIN;
  rows.push([
    { text: "Item", x: MARGIN, bold: true },
    { text: "Qty", x: qtyX, bold: true, right: true },
    { text: "Price", x: priceX, bold: true, right: true },
    { text: "Amount", x: totalX, bold: true, right: true },
  ]);
  for (const i of items) {
    rows.push([
      { text: truncate(i.title + (i.variantTitle ? ` (${i.variantTitle})` : ""), 48), x: MARGIN },
      { text: String(i.quantity), x: qtyX, right: true },
      { text: money(i.unitPriceMinor, order.currency), x: priceX, right: true },
      { text: money(i.totalMinor, order.currency), x: totalX, right: true },
    ]);
    const sub = [i.sku ? `SKU ${i.sku}` : null, order.taxLabel && i.taxRateBps > 0 ? `${order.taxLabel} ${i.taxRateBps / 100}%` : null].filter(Boolean).join(" · ");
    if (sub) rows.push([{ text: sub, x: MARGIN, size: 9, color: [0.4, 0.45, 0.55] }]);
  }
  gap();
  const total = (label: string, minor: number, bold = false) => rows.push([{ text: label, x: priceX, right: true, bold }, { text: money(minor, order.currency), x: totalX, right: true, bold }]);
  total("Subtotal", order.subtotalMinor);
  if (order.discountMinor > 0) total(`Discount${order.discountCode ? ` (${order.discountCode})` : ""}`, -order.discountMinor);
  if (order.deliveryMethod === "delivery") total(order.shippingRateName ? `Delivery: ${truncate(order.shippingRateName, 30)}` : "Delivery", order.deliveryMinor);
  if (order.taxLabel && !order.pricesIncludeTax) total(order.taxLabel, order.taxMinor);
  total("Total", order.totalMinor, true);
  if (order.taxLabel && order.pricesIncludeTax && order.taxMinor > 0) total(`${order.taxLabel} included`, order.taxMinor);
  if (order.refundedMinor > 0) {
    total("Refunded", -order.refundedMinor);
    total("Net", order.totalMinor - order.refundedMinor, true);
  }
  gap();
  gap();
  rows.push([{ text: `Thank you for shopping with ${store.name}.`, x: MARGIN, size: 10, color: [0.4, 0.45, 0.55] }]);

  // Lay rows onto pages.
  const perPage = Math.floor((PAGE_H - 2 * MARGIN) / LINE);
  const pages: string[] = [];
  for (let start = 0; start < rows.length; start += perPage) {
    const ops: string[] = [];
    rows.slice(start, start + perPage).forEach((row, n) => {
      const y = PAGE_H - MARGIN - n * LINE - 10;
      for (const c of row) {
        const size = c.size ?? 11;
        const bold = c.bold ?? false;
        const x = c.right ? c.x - widthOf(latin1(c.text), size, bold) : c.x;
        const [r, g, b] = c.color ?? [0.04, 0.08, 0.19];
        ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${r} ${g} ${b} rg ${x.toFixed(1)} ${y} Td ${pdfString(c.text)} Tj ET`);
      }
    });
    pages.push(ops.join("\n"));
  }
  return assemble(pages);
}

/** Writes the PDF objects and cross-reference table. */
function assemble(pageContents: string[]): Buffer {
  const objects: string[] = [];
  // Object numbers start at 1, so the new length is the new object's number.
  const add = (body: string) => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled in below
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const content of pageContents) {
    const stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
