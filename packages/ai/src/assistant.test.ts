import { describe, expect, it } from "vitest";
import { assistantCapabilities, assistantSystem, MAX_TOOL_CALLS, parseAssistantReply, runAssistantTurn } from "./assistant.js";
import { ProviderError, type CompletionRequest, type JsonCompletionProvider } from "./provider.js";

const signal = new AbortController().signal;

/** A provider that replies from a script, one reply per call, and records what it was sent. */
function scripted(replies: string[]) {
  const calls: CompletionRequest[] = [];
  const provider: JsonCompletionProvider = {
    name: "scripted",
    model: "test",
    complete(request) {
      calls.push(request);
      const text = replies.shift();
      if (text === undefined) throw new ProviderError("provider_unavailable", true);
      return Promise.resolve({ text, usage: { inputTokens: 10, outputTokens: 5 } });
    },
  };
  return { provider, calls };
}

const answer = (text: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "answer", text, navigate: null, action: null, ...extra });
const tool = (name: string, args: Record<string, unknown> = {}) => JSON.stringify({ type: "tool", tool: name, args });

describe("replies", () => {
  it("accepts tool calls and answers, and drops malformed extras", () => {
    expect(parseAssistantReply(tool("get_order", { number: 12 }))).toEqual({ type: "tool", tool: "get_order", args: { number: 12 } });
    expect(parseAssistantReply("```json\n" + answer("Hi") + "\n```")).toMatchObject({ type: "answer", text: "Hi" });
    expect(parseAssistantReply(answer("Open it", { navigate: "order:#42" }))).toMatchObject({ navigate: { order: 42 } });
    expect(parseAssistantReply(answer("Open it", { navigate: "https://evil.example" }))).toMatchObject({ navigate: null });
    expect(parseAssistantReply(answer("Cancel", { action: { kind: "cancel_order", orderNumber: 7 } }))).toMatchObject({ action: { kind: "cancel_order", orderNumber: 7, restock: true } });
    expect(parseAssistantReply(answer("Refund", { action: { kind: "refund_order", orderNumber: 7 } }))).toMatchObject({ action: null });
  });

  it("reads product and offer tasks, keeping only known fields", () => {
    expect(parseAssistantReply(answer("Adding it", { action: { kind: "create_product", title: " Masala Chai ", price: 250, stock: 40, status: "active", evil: "x" } }))).toMatchObject({
      action: { kind: "create_product", product: { title: "Masala Chai", price: 250, stock: 40, status: "active", compareAtPrice: null, tags: [] } },
    });
    // A new product needs a title and a price; it's a draft unless asked otherwise.
    expect(parseAssistantReply(answer("Adding it", { action: { kind: "create_product", title: "Tea" } }))).toMatchObject({ action: null });
    expect(parseAssistantReply(answer("Adding it", { action: { kind: "create_product", title: "Tea", price: 10, status: "published" } }))).toMatchObject({ action: { product: { status: "draft" } } });
    expect(parseAssistantReply(answer("Updating", { action: { kind: "update_product", productId: "0193a2b4-1c2d-7e8f-9a0b-1c2d3e4f5a6b", changes: { price: 280, compareAtPrice: null, stock: -5 } } }))).toMatchObject({
      action: { kind: "update_product", changes: { price: 280, compareAtPrice: null } },
    });
    expect(parseAssistantReply(answer("Updating", { action: { kind: "update_product", productId: "not-an-id", changes: { price: 1 } } }))).toMatchObject({ action: null });
    expect(parseAssistantReply(answer("Code", { action: { kind: "create_discount", code: "diwali10", type: "percentage", value: 10, minSpend: 999, endsOn: "2026-11-15" } }))).toMatchObject({
      action: { kind: "create_discount", discount: { code: "DIWALI10", type: "percentage", value: 10, minSpend: 999, endsOn: "2026-11-15" } },
    });
    expect(parseAssistantReply(answer("Code", { action: { kind: "create_discount", type: "percentage" } }))).toMatchObject({ action: null });
  });

  it("strips markdown the chat can't show", () => {
    expect(parseAssistantReply(answer("## Steps\n1. Go to **Products** and click `Add product`.\n* Then __Save product__."))).toMatchObject({
      text: "Steps\n1. Go to Products and click Add product.\n- Then Save product.",
    });
    expect(parseAssistantReply(answer("Price is 2 * 3 = 6"))).toMatchObject({ text: "Price is 2 * 3 = 6" });
  });

  it("rejects anything outside the protocol", () => {
    expect(parseAssistantReply("Sure! Here's the answer")).toBeUndefined();
    expect(parseAssistantReply(JSON.stringify({ type: "answer", text: "" }))).toBeUndefined();
    expect(parseAssistantReply(JSON.stringify({ type: "tool", tool: "DROP TABLE" }))).toBeUndefined();
    expect(parseAssistantReply(JSON.stringify({ type: "tool", tool: "search_orders", args: { q: "x".repeat(3000) } }))).toBeUndefined();
  });
});

describe("capabilities", () => {
  it("lists only what the member's role allows", () => {
    const analyst = assistantCapabilities(new Set(["products.read", "orders.read", "analytics.read", "finances.read"]));
    expect(analyst.tools.map((t) => t.name)).toContain("sales_report");
    expect(analyst.tools.map((t) => t.name)).not.toContain("list_offers");
    expect(analyst.actions).toEqual([]);
    expect(analyst.pages.map((p) => p.key)).not.toContain("settings");
    const system = assistantSystem({ storeName: "Chai Corner", role: "analyst", memberName: "Asha", currency: "INR", timeZone: "Asia/Kolkata", today: "2026-11-02", permissions: new Set(["orders.read"]) });
    expect(system).toContain("Store: Chai Corner");
    expect(system).toContain("Actions you may propose: none for this role.");
    expect(system).not.toContain("- list_offers");
  });
});

describe("the loop", () => {
  const input = { system: "test", history: [], question: "How many orders?" };

  it("runs tools, feeds results back and returns the answer", async () => {
    const { provider, calls } = scripted([tool("search_orders", { filter: "unpaid" }), answer("You have 2 unpaid orders.")]);
    const ran: string[] = [];
    const turn = await runAssistantTurn(provider, input, (name) => (ran.push(name), Promise.resolve({ ok: true, result: { items: [1, 2] } })), signal);
    expect(turn).toMatchObject({ ok: true, answer: { text: "You have 2 unpaid orders." }, tools: [{ tool: "search_orders", ok: true }], usage: { inputTokens: 20, outputTokens: 10 } });
    expect(ran).toEqual(["search_orders"]);
    expect(calls[1]!.messages.at(-1)!.content).toBe('<tool_result name="search_orders">\n{"items":[1,2]}\n</tool_result>');
  });

  it("stops tool use after the limit and asks for an answer", async () => {
    const { provider, calls } = scripted([...Array.from({ length: MAX_TOOL_CALLS + 1 }, () => tool("store_overview")), answer("Done.")]);
    const turn = await runAssistantTurn(provider, input, () => Promise.resolve({ ok: true, result: {} }), signal);
    expect(turn).toMatchObject({ ok: true, answer: { text: "Done." } });
    expect(turn.tools).toHaveLength(MAX_TOOL_CALLS);
    expect(calls.at(-1)!.messages.at(-1)!.content).toMatch(/used all your tools/);
  });

  it("corrects one invalid reply, then gives up", async () => {
    expect(await runAssistantTurn(scripted(["not json", answer("Fixed.")]).provider, input, () => Promise.resolve({ ok: true, result: {} }), signal)).toMatchObject({ ok: true, answer: { text: "Fixed." } });
    expect(await runAssistantTurn(scripted(["not json", "still not"]).provider, input, () => Promise.resolve({ ok: true, result: {} }), signal)).toMatchObject({ ok: false, code: "invalid_output" });
  });

  it("reports provider failures with their code", async () => {
    expect(await runAssistantTurn(scripted([]).provider, input, () => Promise.resolve({ ok: true, result: {} }), signal)).toMatchObject({ ok: false, code: "provider_unavailable" });
  });
});
