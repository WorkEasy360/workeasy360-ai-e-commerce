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
