import { isSafeHref } from "./theme";

/**
 * Content pages (About us, policies, contact) are written in a small,
 * forgiving subset of Markdown and turned into plain blocks, never HTML:
 *
 *   ## Heading            ### Smaller heading
 *   - item  or  * item    1. numbered item
 *   > a quote
 *   **bold**  *italic*  [link text](/products)  [email us](mailto:hi@shop.in)
 *
 * A blank line starts a new paragraph. Links must be store paths, https,
 * mailto: or tel:; anything else is shown as plain text.
 */

export type ContentInline = { type: "text" | "strong" | "em"; text: string } | { type: "link"; text: string; href: string };

export type ContentBlock =
  | { type: "heading"; level: 2 | 3; text: ContentInline[] }
  | { type: "paragraph"; text: ContentInline[] }
  | { type: "quote"; text: ContentInline[] }
  | { type: "list"; ordered: boolean; items: ContentInline[][] };

export const MAX_PAGE_BODY = 50_000;
const MAX_BLOCKS = 500;

/** Store paths, https, and contact links (mailto:, tel:). */
export function isSafeContentHref(href: string): boolean {
  if (/^mailto:[^\s@<>"]+@[^\s@<>"]+$/.test(href)) return href.length <= 254;
  if (/^tel:\+?[0-9 ()-]{3,20}$/.test(href)) return true;
  return isSafeHref(href);
}

const INLINE = /\*\*(.+?)\*\*|\*(?!\s)(.+?)\*|_(?!\s)(.+?)_|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

export function parseInline(text: string): ContentInline[] {
  const out: ContentInline[] = [];
  const push = (part: ContentInline) => {
    const last = out.at(-1);
    if (part.type === "text" && last?.type === "text") last.text += part.text;
    else if (part.text) out.push(part);
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    push({ type: "text", text: text.slice(at, m.index) });
    if (m[1] !== undefined) push({ type: "strong", text: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) push({ type: "em", text: (m[2] ?? m[3])! });
    else if (isSafeContentHref(m[5]!)) push({ type: "link", text: m[4]!, href: m[5]! });
    else push({ type: "text", text: m[4]! });
    at = m.index + m[0].length;
  }
  push({ type: "text", text: text.slice(at) });
  return out;
}

export function parseContent(source: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: parseInline(paragraph.join(" ")) });
    if (quote.length) blocks.push({ type: "quote", text: parseInline(quote.join(" ")) });
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    paragraph = [];
    quote = [];
    list = null;
  };
  for (const raw of source.slice(0, MAX_PAGE_BODY).split(/\r?\n/)) {
    if (blocks.length >= MAX_BLOCKS) break;
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d{1,3}[.)]\s+(.+)$/.exec(line);
    const quoted = /^>\s?(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length === 3 ? 3 : 2, text: parseInline(heading[2]!) });
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
    } else if (quoted) {
      if (!quote.length) flush();
      quote.push(quoted[1]!);
    } else if (list) {
      // A line under a list item continues it.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (quote.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** The first paragraph as plain text, for a page's meta description. */
export function contentSummary(source: string, max = 160): string {
  const first = parseContent(source).find((b) => b.type === "paragraph");
  const text = first && first.type === "paragraph" ? first.text.map((i) => i.text).join("") : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Templates -------------------------------------------------------------------------------------

export interface PageTemplate {
  handle: string;
  title: string;
  /** What the merchant should check before publishing. */
  note: string;
  body: (store: { name: string; email: string | null }) => string;
}

/** Starting points for the pages most shops need; the merchant edits them before publishing. */
export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    handle: "about",
    title: "About us",
    note: "Tell your own story: who you are, what you make and why.",
    body: ({ name }) =>
      `${name} began with a simple idea: make good things, sell them honestly, and look after every customer.\n\n## What we make\n\nDescribe your products, where they come from and what makes them special.\n\n## Why shop with us\n\n- Carefully chosen products\n- Secure checkout, with cash on delivery where available\n- Real people answering your messages\n\n[Browse the shop](/products)`,
  },
  {
    handle: "shipping-policy",
    title: "Shipping policy",
    note: "Check the delivery times, charges and areas match your shipping settings.",
    body: () =>
      `We pack orders within 1–2 business days.\n\n## Delivery times\n\n- Metro cities: 2–4 business days\n- Rest of India: 4–7 business days\n\n## Charges\n\nDelivery charges are shown at checkout before you pay.\n\n## Tracking\n\nOnce your order ships, we email you the courier and tracking number.`,
  },
  {
    handle: "returns-policy",
    title: "Returns and refunds",
    note: "Set your own return window and conditions; check local consumer law.",
    body: ({ email }) =>
      `We want you to love your order. If something isn't right, tell us within **7 days** of delivery.\n\n## Returns\n\n1. Contact us with your order number${email ? ` at [${email}](mailto:${email})` : ""}.\n2. Send the item back unused, in its original packaging.\n3. We refund you within 7 days of receiving it.\n\n## Exceptions\n\nDigital downloads, gift cards and personalised items can't be returned. Damaged or wrong items are always replaced or refunded.`,
  },
  {
    handle: "privacy-policy",
    title: "Privacy policy",
    note: "Have it reviewed for your business and the laws that apply to you.",
    body: ({ name, email }) =>
      `This policy explains what ${name} collects when you shop with us and how we use it.\n\n## What we collect\n\n- Your name, email, phone and address, to deliver your order\n- Your order history, to help with returns and support\n\nWe don't sell your personal information. Card payments are handled by our payment provider; we never see your card number.\n\n## Your choices\n\nYou can ask us to see, correct or delete your information${email ? ` by writing to [${email}](mailto:${email})` : ""}.`,
  },
  {
    handle: "terms",
    title: "Terms of service",
    note: "Have it reviewed for your business and the laws that apply to you.",
    body: ({ name }) =>
      `By placing an order with ${name} you agree to these terms.\n\n## Orders and prices\n\nPrices are shown at checkout, including any taxes and delivery. We may cancel an order if an item is unavailable or wrongly priced, and refund anything you've paid.\n\n## Payments\n\nOrders are confirmed once payment is received, or when you choose cash on delivery.\n\n## Contact\n\nQuestions about these terms? [Get in touch](/pages/contact).`,
  },
  {
    handle: "contact",
    title: "Contact us",
    note: "Add your phone number, address and hours.",
    body: ({ email }) =>
      `We're happy to help with orders, products and anything else.\n\n${email ? `- Email: [${email}](mailto:${email})\n` : ""}- Phone: [+91 00000 00000](tel:+910000000000)\n- Hours: Monday to Saturday, 10am to 6pm\n\nPlease include your order number if your message is about an order.`,
  },
];
