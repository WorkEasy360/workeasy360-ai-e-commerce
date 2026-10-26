import { describe, expect, it } from "vitest";
import { contentSummary, PAGE_TEMPLATES, parseContent, parseInline } from "./content";

describe("page content", () => {
  it("turns headings, paragraphs, lists and quotes into blocks", () => {
    const blocks = parseContent("# Our story\nWe started\nin 2019.\n\n### Values\n- Fair prices\n- Fast\n  shipping\n1. Order\n2. Enjoy\n\n> Best chai ever\n> - Asha");
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: [{ type: "text", text: "Our story" }] },
      { type: "paragraph", text: [{ type: "text", text: "We started in 2019." }] },
      { type: "heading", level: 3, text: [{ type: "text", text: "Values" }] },
      { type: "list", ordered: false, items: [[{ type: "text", text: "Fair prices" }], [{ type: "text", text: "Fast shipping" }]] },
      { type: "list", ordered: true, items: [[{ type: "text", text: "Order" }], [{ type: "text", text: "Enjoy" }]] },
      { type: "quote", text: [{ type: "text", text: "Best chai ever - Asha" }] },
    ]);
  });

  it("formats bold, italic and safe links, and shows unsafe links as text", () => {
    expect(parseInline("**Free** delivery, *always*. [Shop](/products) or [mail](mailto:hi@chai.in) or [call](tel:+919876543210)")).toEqual([
      { type: "strong", text: "Free" },
      { type: "text", text: " delivery, " },
      { type: "em", text: "always" },
      { type: "text", text: ". " },
      { type: "link", text: "Shop", href: "/products" },
      { type: "text", text: " or " },
      { type: "link", text: "mail", href: "mailto:hi@chai.in" },
      { type: "text", text: " or " },
      { type: "link", text: "call", href: "tel:+919876543210" },
    ]);
    expect(parseInline("[click](javascript:alert(1)) <script>x</script>")).toEqual([{ type: "text", text: "click) <script>x</script>" }]);
    expect(parseInline("[x](//evil.example)")).toEqual([{ type: "text", text: "x" }]);
  });

  it("summarises the first paragraph and fills templates with the store's details", () => {
    expect(contentSummary("## Hi\n\nWe make **great** tea.\n\nMore.")).toBe("We make great tea.");
    expect(contentSummary("a".repeat(300), 20)).toHaveLength(20);
    const returns = PAGE_TEMPLATES.find((t) => t.handle === "returns-policy")!;
    expect(returns.body({ name: "Chai & Co", email: "hi@chai.in" })).toContain("[hi@chai.in](mailto:hi@chai.in)");
    for (const t of PAGE_TEMPLATES) expect(parseContent(t.body({ name: "Chai & Co", email: null })).length).toBeGreaterThan(1);
  });
});
