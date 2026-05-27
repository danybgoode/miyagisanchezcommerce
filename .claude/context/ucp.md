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
| `check_availability` | Cal.com real-time slot availability for a listing |
| `book_appointment` | Book an appointment slot — test drive, visit, or meeting |
| `get_buyer_trust` | OmniReputation score (0–100) for a buyer by email or Clerk ID |

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

## Data sources — what reads from where

Migration is complete. UCP/MCP routes read from Medusa for all catalog/shop data:

| UCP concern | Data source | How |
|---|---|---|
| Product catalog (`search_listings`, `get_listing`) | **Medusa** | `GET /store/listings` or `/store/listings/:id` |
| Shop/seller profile (`get_shop`) | **Medusa** | `GET /store/sellers/:slug` |
| Seller's listings (`get_shop`) | **Medusa** | `GET /store/listings?seller_slug=:slug` |
| Payment options (`get_checkout_options`) | Internal `/api/ucp/checkout-session` | Calls Medusa payment providers |
| Offer state (`make_offer`) | Supabase `marketplace_offers` | Listing validation via Medusa, offer write to Supabase |
| Buyer trust (`get_buyer_trust`) | Supabase `ucp_buyer_identities` + Clerk | Stays on Supabase |
| Conversations | Supabase `marketplace_conversations` | Stays on Supabase |
| Favorites | Supabase `marketplace_favorites` | Stays on Supabase |
| Cal.com scheduling (`check_availability`, `book_appointment`) | Medusa listing → `shop.metadata.calcom_api_key` | Via listing endpoint |

**Rule**: If it's catalog/product/seller data → Medusa. If it's marketplace social layer (offers, messages, trust) → Supabase.

The `toUcpListing(listing, baseUrl)` function in `lib/ucp/schema.ts` converts a `Listing` (from Medusa `/store/listings`) into a `UcpListing`. No separate mapper needed.

---

## UCP response types (lib/ucp/schema.ts)

Key types that all UCP routes must return:

```ts
UcpListing      // single listing with price, actions, trust, payment_methods, schema_org
UcpCatalogResponse  // paginated list with cursor
UcpCheckoutSession  // all payment options ranked + escrow info + listing snapshot
```

The `toUcpListing(listing, baseUrl)` mapper accepts the `Listing` type from `lib/types.ts` (identical shape to what `GET /store/listings` returns) and always produces a valid `UcpListing`.

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
