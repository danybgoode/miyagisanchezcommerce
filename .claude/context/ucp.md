# UCP / MCP — AI-Native Commerce

## What is UCP?

**Universal Commerce Protocol** (https://ucp.dev) is an open standard for agentic commerce backed by Google, Shopify, Amazon, Microsoft, Meta, Stripe, Visa, Mastercard, and 100+ others. It defines a common language so AI agents can browse, negotiate, and buy across any merchant without custom integrations.

Built on: REST + JSON-RPC, OAuth 2.0 (identity/auth), MCP (Model Context Protocol), A2A (Agent-to-Agent), AP2 (Agent Payments Protocol).

miyagisanchez.com is a **first-mover UCP implementation** — the full commerce lifecycle is available to AI agents natively.

---

## Why this matters for miyagisanchez

Every use case in `ucp-use-cases.json` is real and mapped to live endpoints:
- P2P discovery → `/api/ucp/catalog`
- Price negotiation (A2A) → `make_offer` MCP tool
- Embedded checkout → `/api/ucp/checkout-session`
- REPUVE/vehicle trust → trust signals in catalog response
- Escrow → escrow fields on checkout session
- Identity pre-qualification → `/api/ucp/identity/[identifier]`
- Order tracking → Medusa order webhooks

---

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ucp/manifest` | GET | Capability discovery — AI agents fetch this first |
| `/api/ucp/catalog` | GET | Product search with UCP-shaped response + trust signals |
| `/api/ucp/catalog/[id]` | GET | Single listing with full actions, payment options, schema.org |
| `/api/ucp/checkout-session` | POST | All payment methods for a listing — returns ranked options |
| `/api/ucp/mcp` | POST | MCP server (JSON-RPC 2.0) — full tool set |
| `/api/ucp/identity/[identifier]` | GET | OmniReputation trust score for a buyer |

All UCP endpoints have open CORS (`Access-Control-Allow-Origin: *`) — any AI agent can query them.

---

## MCP Server tools

The MCP server at `/api/ucp/mcp` is stateless HTTP JSON-RPC 2.0 (no SSE, works with any MCP client).

| Tool | Description |
|---|---|
| `search_listings` | Search catalog with full filter set — returns UCP listings with checkout URLs |
| `get_listing` | Full detail for one listing including trust signals, REPUVE status, payment options |
| `get_checkout_options` | All available payment methods for a listing, ranked, with pre-generated URLs |
| `create_checkout` | Generate a single payment URL (MP or Stripe) — returns redirect URL |
| `make_offer` | Submit a price offer → returns `offer_id` for tracking |
| `get_shop` | Seller profile + their active listings |

**Claude Desktop config**:
```json
{
  "mcpServers": {
    "miyagisanchez": {
      "type": "http",
      "url": "https://miyagisanchez.com/api/ucp/mcp"
    }
  }
}
```

---

## Data sources (current → target)

UCP routes currently read from Supabase. As the Medusa migration progresses, they switch to Medusa:

| UCP concern | Current source | Target source |
|---|---|---|
| Product catalog | Supabase `marketplace_listings` | Medusa Store API `/store/products` |
| Shop/vendor info | Supabase `marketplace_shops` | Medusa marketplace vendor API |
| Payment options | Custom logic | Medusa payment providers + custom logic |
| Order tracking | Supabase `marketplace_orders` | Medusa Orders API |
| Offer state | Supabase `marketplace_offers` | Supabase (stays — not a Medusa concern) |
| Trust/identity | Supabase `ucp_buyer_identities` | Supabase (stays) |

**When updating a UCP route to use Medusa**: import `medusa` from `@/lib/medusa`, call the Store API, and pass through the same UCP response shape. The `toUcpListing()` mapper in `lib/ucp/schema.ts` will need updating to accept Medusa product shape.

---

## UCP response types (lib/ucp/schema.ts)

Key types that all UCP routes must return:

```ts
UcpListing      // single listing with price, actions, trust, payment_methods, schema_org
UcpCatalogResponse  // paginated list with cursor
UcpCheckoutSession  // all payment options ranked + escrow info + listing snapshot
```

The `toUcpListing(product, baseUrl)` mapper must always return a valid `UcpListing`. When switching from Supabase `Listing` type to Medusa `StoreProduct` type, update this mapper.

---

## Trust signals

Trust is a key differentiator vs. Craigslist/Facebook Marketplace. Every UCP listing response includes:

```ts
trust: {
  verified_seller: boolean       // seller completed Clerk verification
  escrow_mode: 'off' | 'optional' | 'required'
  repuve_checked: boolean        // vehicle history verified (autos category)
  identity_required: boolean     // listing requires buyer identity
}
```

These come from vendor metadata (Medusa) + UCP identity table (Supabase).

---

## Adding a new capability to UCP

1. Add the capability string to `GET /api/ucp/manifest` → `capabilities[]`
2. Implement the endpoint or MCP tool
3. If it needs auth: use OAuth 2.0 (the Clerk JWT bridge satisfies this)
4. Document in `ucp-use-cases.json`
5. Add the MCP tool definition to the `TOOLS` array in `/api/ucp/mcp/route.ts`

---

## Webhooks (UCP order events)

Sellers can register a webhook URL in their shop settings (`ucp_webhook_url`). Medusa order events trigger `lib/ucp/webhooks.ts` which signs and delivers the event payload. This is the UCP Order Management capability — buyers' AI agents get real-time order updates.
