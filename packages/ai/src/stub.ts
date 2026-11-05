import type { CompletionRequest, JsonCompletionProvider } from "./provider.js";

/**
 * A deterministic local provider for development and tests, so AI Studio
 * works end to end without a provider account. It fills each task's shape
 * from the data it was given. It is not a model, and its copy says so to
 * nobody: it is plain and factual on purpose.
 */
export function stubProvider(): JsonCompletionProvider {
  return {
    name: "stub",
    model: "stub-1",
    complete(request: CompletionRequest) {
      if (request.system.startsWith("# Workeasy AI Commerce assistant")) return Promise.resolve(stubAssistant(request));
      const prompt = request.messages[0]?.content ?? "";
      const data = (() => {
        const m = /<data>\n([\s\S]*?)\n<\/data>/.exec(prompt);
        try {
          return (m ? JSON.parse(m[1]!) : {}) as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      const store = /^Store: (.*)$/m.exec(prompt)?.[1] ?? "our shop";
      const title = typeof data.title === "string" ? data.title : "this item";
      let out: unknown;
      if (prompt.includes("search tags for this product")) {
        const options = Array.isArray(data.options) ? (data.options as Array<{ name: string; values: string[] }>) : [];
        const choice = options.length ? ` Choose from ${options.map((o) => `${o.values.length} ${o.name.toLowerCase()} options`).join(" and ")}.` : "";
        out = {
          description: `${title} from ${store}, made for everyday use and chosen with care.${choice}\n\nOrder online and we'll get it to you quickly. Questions? Message us any time.`,
          seoTitle: `${title} | ${store}`.slice(0, 60),
          seoDescription: `Buy ${title} online from ${store}. Easy ordering and quick delivery.`.slice(0, 155),
          tags: [...new Set([title.toLowerCase().split(/\s+/)[0] ?? "gift", String(data.type ?? "product"), "online"])],
        };
      } else if (prompt.includes("collection description")) {
        out = {
          description: `Explore ${title} at ${store}: ${Array.isArray(data.products) ? (data.products as string[]).slice(0, 3).join(", ") : "our favourites"} and more, picked for you.`,
          seoTitle: `${title} | ${store}`.slice(0, 60),
          seoDescription: `Shop the ${title} collection at ${store}.`.slice(0, 155),
        };
      } else if (prompt.includes("Summarise what buyers say")) {
        const reviews = Array.isArray(data.reviews) ? (data.reviews as Array<{ rating: number; text: string }>) : [];
        const avg = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : 0;
        out = {
          summary: `Buyers rate ${title} ${avg.toFixed(1)} out of 5 across ${reviews.length} review${reviews.length === 1 ? "" : "s"}.`,
          pros: reviews.filter((r) => r.rating >= 4).slice(0, 3).map((r) => r.text.split(/[.!]/)[0]!.slice(0, 120)).filter(Boolean),
          cons: reviews.filter((r) => r.rating <= 3).slice(0, 2).map((r) => r.text.split(/[.!]/)[0]!.slice(0, 120)).filter(Boolean),
        };
      } else {
        const t = (data.totals ?? {}) as Record<string, number>;
        out = {
          insights: [
            { title: "Revenue this period", detail: `You took ${t.orders ?? 0} orders from ${t.visitors ?? 0} visitors. Keep sharing your store link where those visitors came from.` },
            { title: "Turn product views into carts", detail: "Products with many views and few sales may need better photos or a clearer price. Start with your most viewed one." },
            { title: "Ask for reviews", detail: "Reviews help new shoppers decide. Turn on review request emails in Reviews." },
          ],
        };
      }
      const text = JSON.stringify(out);
      return Promise.resolve({ text, usage: { inputTokens: Math.ceil((request.system.length + prompt.length) / 4), outputTokens: Math.ceil(text.length / 4) } });
    },
  };
}

/**
 * The assistant's side of the stub: routes a question to one tool by its
 * words, then answers with what the tool returned. Enough to exercise the
 * whole loop (tools, navigation, proposals) without a model.
 */
function stubAssistant(request: CompletionRequest): { text: string; usage: { inputTokens: number; outputTokens: number } } {
  const last = request.messages.at(-1)?.content ?? "";
  const question = request.messages.findLast((m) => m.role === "user" && !m.content.startsWith("<tool_result"))?.content.toLowerCase() ?? "";
  const tools = new Set([...request.system.matchAll(/^- ([a-z_]+) [{]/gm)].map((m) => m[1]));
  const number = /#\s*(\d{1,9})\b|\border\s+(\d{1,9})\b/.exec(question);
  const orderNumber = number ? Number(number[1] ?? number[2]) : undefined;
  let out: unknown;
  const result = /^<tool_result name="([a-z_]+)">\n([\s\S]*)\n<\/tool_result>$/.exec(last);
  if (result) {
    const [, tool, body] = result;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(body!) as Record<string, unknown>;
    } catch {
      // Truncated results are summarised without their contents.
    }
    if (data.error) out = { type: "answer", text: `I couldn't get that: ${String(data.error)}`, navigate: null, action: null };
    else if (tool === "get_order" && /\b(paid|received)\b/.test(question) && orderNumber)
      out = { type: "answer", text: `Order #${orderNumber} is ready to be marked as paid. Confirm below once you're sure the money has arrived.`, navigate: null, action: { kind: "mark_order_paid", orderNumber } };
    else {
      const items = Array.isArray(data.items) ? data.items.length : undefined;
      out = { type: "answer", text: items === undefined ? `Here's what I found (${tool}).` : `I found ${items} result${items === 1 ? "" : "s"} (${tool}).`, navigate: null, action: null };
    }
  } else if (/\b(add|create)\b.*\bproduct\b/.test(question) && /(?:₹|rs\.?|inr|price)\s*(\d+(?:\.\d+)?)/.test(question)) {
    const original = request.messages.findLast((m) => m.role === "user" && !m.content.startsWith("<tool_result"))?.content ?? "";
    const price = Number(/(?:₹|rs\.?|inr|price)\s*(\d+(?:\.\d+)?)/i.exec(original)![1]);
    const title = /"([^"]+)"/.exec(original)?.[1] ?? /product\s+(.+?)\s+(?:for|at|price)\b/i.exec(original)?.[1] ?? "New product";
    const stock = /(\d+)\s*(?:in stock|units|pcs|pieces)/i.exec(original)?.[1];
    out = {
      type: "answer",
      text: `I'll add ${title} at ${price}. Confirm below to create it.`,
      navigate: null,
      action: { kind: "create_product", title, price, ...(stock ? { stock: Number(stock) } : {}), status: /\b(live|active|publish)/.test(question) ? "active" : "draft" },
    };
  } else if (/\bproduct\s+[0-9a-f-]{36}\b.*\bprice\b/.test(question) && /\bto\s+(\d+(?:\.\d+)?)/.test(question)) {
    const productId = /\bproduct\s+([0-9a-f-]{36})\b/.exec(question)![1];
    out = { type: "answer", text: "I'll update the price.", navigate: null, action: { kind: "update_product", productId, changes: { price: Number(/\bto\s+(\d+(?:\.\d+)?)/.exec(question)![1]) } } };
  } else if (/\bcode\s+[a-z0-9_-]{3,32}\b/.test(question) && /(\d+)\s*%/.test(question)) {
    const code = /\bcode\s+([a-z0-9_-]{3,32})\b/i.exec(request.messages.at(-1)?.content ?? question)?.[1] ?? "SAVE";
    out = { type: "answer", text: `I'll create the code ${code.toUpperCase()}.`, navigate: null, action: { kind: "create_discount", code, type: "percentage", value: Number(/(\d+)\s*%/.exec(question)![1]) } };
  } else if (/\b(open|go to|take me)\b/.test(question)) {
    const page = ["orders", "products", "inventory", "analytics", "offers", "reviews", "settings"].find((p) => question.includes(p)) ?? "dashboard";
    out = { type: "answer", text: `Opening ${page}.`, navigate: page, action: null };
  } else {
    const route: Array<[RegExp, string, Record<string, unknown>]> = [
      [/\b(paid|orders?)\b/, orderNumber ? "get_order" : "search_orders", orderNumber ? { number: orderNumber } : {}],
      [/\b(stock|inventory)\b/, "stock_report", { filter: "low" }],
      [/\b(sales|revenue|visitors|best)\b/, "sales_report", { days: 30 }],
      [/\bproducts?\b/, "search_products", {}],
      [/\bcustomers?\b/, "search_customers", {}],
      [/\b(offers?|discounts?|codes?)\b/, "list_offers", {}],
      [/\breviews?\b/, "pending_reviews", {}],
      [/\b(payments?|razorpay|stripe|upi)\b/, "payment_setup", {}],
      [/\bbookings?\b/, "list_bookings", {}],
    ];
    const hit = route.find(([re, tool]) => re.test(question) && tools.has(tool));
    out = hit ? { type: "tool", tool: hit[1], args: hit[2] } : { type: "answer", text: "I can look up orders, products, stock, customers, sales and more for this store. What would you like to know?", navigate: null, action: null };
  }
  const text = JSON.stringify(out);
  return { text, usage: { inputTokens: Math.ceil((request.system.length + last.length) / 4), outputTokens: Math.ceil(text.length / 4) } };
}
