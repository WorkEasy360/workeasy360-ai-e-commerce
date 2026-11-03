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
