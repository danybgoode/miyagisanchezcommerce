/**
 * Canonical catalog of the public agent-facing surface — the SINGLE source of
 * truth for which UCP endpoints and MCP tools exist.
 *
 * Why this module exists: endpoint/tool metadata used to be hand-copied into
 * three places (the `/agent` briefing page, the UCP manifest route, and the MCP
 * server's discovery) and drifted out of sync — the `/agent` page advertised
 * endpoints that 404. Everything that *documents* the API now imports from here,
 * so the docs cannot diverge from reality again.
 *
 * Paths are relative (start with `/api/...`); consumers prefix the request base.
 * The actual MCP tool *definitions* (input schemas, handlers) still live in
 * `app/api/ucp/mcp/route.ts` — this module only names them for discovery docs.
 */

export interface UcpEndpoint {
  id: string
  method: 'GET' | 'POST' | 'GET+POST'
  /** Relative path, e.g. `/api/ucp/catalog`. Prefix with the request base URL. */
  path: string
  description: string
  auth: 'none' | 'clerk_session_or_authorization_header'
}

/** Public REST endpoints an agent can call directly. Must match real routes. */
export const UCP_ENDPOINTS: UcpEndpoint[] = [
  {
    id: 'catalog_search',
    method: 'GET',
    path: '/api/ucp/catalog',
    description: 'Search and filter active listings (full-text es-MX, category, price, location, condition, automotive/real-estate filters). Cursor-paginated.',
    auth: 'none',
  },
  {
    id: 'listing_detail',
    method: 'GET',
    path: '/api/ucp/catalog/{id}',
    description: 'Full UCP detail for one listing: trust signals, seller, images, payment methods, checkout URLs.',
    auth: 'none',
  },
  {
    id: 'checkout_session',
    method: 'POST',
    path: '/api/ucp/checkout-session',
    description: 'Get ALL payment options for a listing in one call (instant: MercadoPago, Stripe — with ready URLs; contact-first: SPEI/CLABE, cash, WhatsApp).',
    auth: 'none',
  },
  {
    id: 'checkout_mercadopago',
    method: 'POST',
    path: '/api/mp/checkout',
    description: 'Create a MercadoPago Checkout Pro session (cards, OXXO, wallet, meses sin intereses). Returns checkoutUrl.',
    auth: 'none',
  },
  {
    id: 'checkout_stripe',
    method: 'POST',
    path: '/api/stripe/checkout',
    description: 'Create a Stripe Checkout session for card payments. Returns checkoutUrl.',
    auth: 'none',
  },
  {
    id: 'make_offer',
    method: 'POST',
    path: '/api/offers',
    description: 'Submit a price offer on a listing. Seller has 48h to accept, counter, or decline. Requires an authenticated Miyagi buyer session.',
    auth: 'clerk_session_or_authorization_header',
  },
  {
    id: 'buyer_trust',
    method: 'GET',
    path: '/api/ucp/identity/{identifier}',
    description: 'OmniReputation trust score for a buyer by email or Clerk user ID. Returns score, level, and signals (no PII beyond the identifier).',
    auth: 'none',
  },
  {
    id: 'manifest',
    method: 'GET',
    path: '/api/ucp/manifest',
    description: 'Machine-readable capability manifest. Fetch first to discover everything this API can do.',
    auth: 'none',
  },
  {
    id: 'mcp',
    method: 'GET+POST',
    path: '/api/ucp/mcp',
    description: 'Model Context Protocol server (HTTP / JSON-RPC 2.0). Connect from Claude Desktop, Gemini, or any MCP client for native shopping + seller-config tools.',
    auth: 'none',
  },
]

/** MCP buyer/shopping tools (no auth). */
export const MCP_BUYER_TOOLS = [
  'search_listings',
  'get_listing',
  'get_checkout_options',
  'create_checkout',
  'make_offer',
  'get_shop',
  'check_availability',
  'book_appointment',
  'get_buyer_trust',
] as const

/**
 * MCP seller tools (Sprint 4). Require a per-shop bearer token
 * (`Authorization: Bearer ms_agent_…`) provisioned in the shop's
 * "Agentes e integraciones" settings; scoped to a single shop.
 */
export const MCP_SELLER_TOOLS = [
  'get_store_configuration',
  'patch_store_configuration',
  'list_offers',
  'respond_to_offer',
  'create_listing',
  'list_my_listings',
  'update_listing',
  'set_listing_status',
] as const

/** Every MCP tool name, in discovery order. */
export const MCP_TOOL_NAMES: string[] = [...MCP_BUYER_TOOLS, ...MCP_SELLER_TOOLS]

/** High-level capability slugs advertised in the manifest. */
export const UCP_CAPABILITIES = [
  'catalog_search',
  'listing_detail',
  'make_offer',
  'buy_now_mercadopago',
  'buy_now_stripe',
  'escrow',
  'scheduling',          // check_availability + book_appointment
  'buyer_trust',         // OmniReputation
  'mcp_server',
  'seller_configuration', // get/patch_store_configuration (token-scoped, Sprint 4)
] as const

/** Build absolute endpoint URLs for a given request base (e.g. https://miyagisanchez.com). */
export function ucpEndpointsWithBase(base: string): Array<UcpEndpoint & { url: string }> {
  return UCP_ENDPOINTS.map((e) => ({ ...e, url: `${base}${e.path}` }))
}
