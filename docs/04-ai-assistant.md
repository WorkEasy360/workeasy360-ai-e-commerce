# 04 · AI assistant

The admin has a store assistant: a round chat button floating in the bottom-right corner of every admin page.

- **Desktop and tablet:** it opens a chat window just above the button. The window doesn't block the page, so the store stays visible and usable.
- **Phones:** the chat takes the whole screen, with a close button in its header.
- **Pages with a sticky Save bar:** the button moves up so it never covers Save.
- **Keyboard:** Escape closes the chat, and focus returns to the button.

The chat window component is `assistant-panel.tsx`, styled by `.c-fab` and `.c-chatbox`. The team can ask about their orders, products, stock, customers and sales, find pages, and have routine order changes prepared for them.

The prompt is `ASSISTANT_PROMPT` in `packages/ai/src/assistant.ts`. It is the WorkEasy360 Booker agent prompt rewritten for commerce:

- **Tenant:** an organisation becomes a store.
- **Records:** services, staff and workspaces become products, collections, inventory, offers and shipping.
- **Bookings:** appointments become orders. Bookable services keep their bookings.
- **Roles:** the five store roles (owner, admin, staff, fulfilment, analyst).

Its rules carry over unchanged: store isolation first, real data over guesses, confirmation before changes, and honest payment and integration status.

## How it works

1. The member asks a question. The API (`POST /api/v1/stores/:storeId/assistant`) checks they are an active member and takes one question from the store's daily allowance.
2. The model receives the prompt plus a context block: store, member, role, currency, time zone, today's date, and only the tools, actions and pages that role may use.
3. The model replies in a small JSON format. It can either ask for a **read-only tool** or give an **answer**. It may use up to 4 tools per question.
4. Each tool runs in its own short transaction, scoped to the store by row-level security. The member's permissions are checked again on every call, so a role change takes effect mid-question.
5. An answer can include a **link** (a page key, an order or a product) and a **proposed action**. The server resolves both against the store as it is now:
   - a link the role can't open is dropped
   - an action is verified against the order (it exists, is open, is in the right state, the role holds `orders.manage`)
   - the result is a confirmation card listing the checked facts and the effect
6. Nothing changes until the member presses the card's button. The admin then calls the **existing endpoint**, the same one as the Orders page, which validates, audits and reports the real result. A change is reported as done only when the server says so.

## Tools (read-only)

| Tool | Needs | Returns |
|---|---|---|
| `store_overview` | any member | Name, status, storefront address, currency, time zone, today's date, product and order counts (where the role can see them) |
| `search_products`, `get_product` | `products.read` | Status, type, prices, variants, stock, tags |
| `search_orders`, `get_order` | `orders.read` | Statuses, payment method, totals, items, timeline. Delivery city and PIN only, not the full address |
| `search_customers` | `customers.read` | Name, email, order count, total spent. No phone numbers |
| `stock_report` | `inventory.read` | Low or out-of-stock variants and the stock summary |
| `sales_report` | `analytics.read` | The Analytics report for 7, 30 or 90 days, with the previous period |
| `list_bookings` | `orders.read` | Upcoming bookings for service products |
| `list_offers` | `offers.manage` | Codes and automatic offers with conditions and usage |
| `pending_reviews` | `reviews.manage` | Reviews waiting for moderation |
| `payment_setup` | `finances.read` or `payments.manage` | Connected gateways (provider, test or live mode, on or off) and which chat and offline methods are on. Never keys or key hints |

## Actions (confirmed by the member)

| Action | Allowed when | Endpoint |
|---|---|---|
| `mark_order_paid` | Open order, payment pending, paid by WhatsApp, Telegram, UPI, bank transfer or cash on delivery. **Never card orders:** only the gateway confirms those | `POST …/orders/:id/paid` |
| `mark_order_fulfilled` | Open order with items left to fulfil | `POST …/orders/:id/fulfilled` |
| `cancel_order` | Open order. A paid card order must be refunded first | `POST …/orders/:id/cancel` |
| `create_product` | Title and price given. Physical, one price, optional "was" price, stock, SKU, tags and description. Stays a draft unless the member asks for it live. Checked with the same rules as the product form | `POST …/products` |
| `update_product` | A product found by search. Can change price, "was" price, stock, status, title, description or add tags. Every other field is sent back unchanged. Price and stock only for single-variant products, and unchanged values are skipped | `PUT …/products/:id` |
| `create_discount` | Percentage, fixed amount or free shipping, with or without a code. Optional minimum spend, end date, usage limit and once per customer. Checked with the same rules as the Offers form | `POST …/discounts` |

The assistant works as an agent. When you ask for one of these tasks, it gathers what's missing (it never invents a price, code or value) and prepares the action. The card shows the details exactly as they'll be saved, and one click carries the task out. The reply then links to the result, such as the new product or Offers.

Some things need a page: product photos, variants and options, digital files, bookable services, shipping, settings, staff, refunds and design. For those, the assistant explains the steps and links to the right page.

## Safety

- **Store isolation** comes from the database (row-level security) and the membership check, not from the prompt. Members of other stores get 404.
- **The model cannot write.** It has no write tools, and the actions it proposes are only suggestions. Forged chat history doesn't help an attacker either: every tool and endpoint checks the signed-in member.
- **Tool results are data.** Shopper and staff text (names, notes, reviews) is marked as data in the prompt, and the model is told never to follow instructions found inside it.
- **Replies are checked.** Every reply is validated against the JSON format. A malformed reply gets one correction, and a second one ends the question with an error. Links outside the page list and unknown actions are dropped.
- **What's logged:** each question logs the tools used, success or failure, and token counts. Questions, answers and tool data are not logged. Confirmed actions appear in the audit log through their endpoints.
- **The chat history** stays in the browser tab (session storage). The server stores no conversations.

## Settings

The API calls the provider itself (the worker does so for AI Studio), using the same settings:

| Setting | Meaning |
|---|---|
| `AI_PROVIDER` | `gemini`, `openai`, `stub` (a local, deterministic stand-in for development and tests) or `disabled` (the panel then says the assistant isn't set up) |
| `AI_MODEL`, `GEMINI_API_KEY` / `OPENAI_API_KEY` | Required for a real provider. The API refuses to start without them |
| `ASSISTANT_DAILY_LIMIT` | Questions per store per day (default 200), counted in `ai_usage_days.assistant_messages`. Separate from AI Studio's `AI_DAILY_LIMIT` |

The limits on one question:
- 4 tools at most, and 50 seconds in total
- replies capped at 1,500 tokens
- the last 12 messages of history are sent
- a question can be up to 2,000 characters
