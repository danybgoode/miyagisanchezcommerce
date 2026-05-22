/**
 * Miyagi Sánchez UCP MCP Server (Stateless HTTP / JSON-RPC 2.0)
 *
 * MCP over HTTP is plain JSON-RPC 2.0. This handler avoids the Node.js HTTP
 * transport layer and works natively with Next.js App Router.
 *
 * To connect from Claude Desktop, add to claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "miyagisanchez": {
 *       "type": "http",
 *       "url": "https://miyagisanchez.com/api/ucp/mcp"
 *     }
 *   }
 * }
 *
 * Tools:
 *   search_listings       Browse catalog with filters
 *   get_listing           Full detail for one listing
 *   get_checkout_options  All payment methods for a listing with pre-generated URLs
 *   create_checkout       Generate a single payment URL (MP or Stripe)
 *   make_offer            Submit price offer → returns offer_id
 *   get_shop              Seller profile + their listings
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { toUcpListing } from '@/lib/ucp/schema'
import { computeTrustScore } from '@/lib/ucp/identity'
import { getCalAvailableSlots, createCalBooking } from '@/lib/calcom'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import type { Listing } from '@/lib/types'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
}

// ── JSON-RPC types ─────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function err(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_listings',
    description: 'Search the Miyagi Sánchez marketplace catalog. Returns listings with prices, trust signals, and checkout URLs. Use this to find products, services, cars, real estate, and more across Mexico.',
    inputSchema: {
      type: 'object',
      properties: {
        q:            { type: 'string', description: 'Search query in Spanish (e.g. "iPhone 14 pro" or "taller mecánico CDMX")' },
        category:     { type: 'string', enum: ['autos','inmuebles','electronica','hogar','moda','deportes','servicios','mascotas','herramientas','negocios','otros'], description: 'Product category' },
        listing_type: { type: 'string', enum: ['product','service','rental','digital'], description: 'Type of listing' },
        state:        { type: 'string', description: 'Mexican state e.g. "Ciudad de México", "Jalisco", "Nuevo León"' },
        location:     { type: 'string', description: 'City or neighborhood e.g. "Polanco", "Monterrey"' },
        condition:    { type: 'string', enum: ['new','like_new','good','fair','parts'], description: 'Item condition' },
        min_price:    { type: 'number', description: 'Minimum price in MXN pesos' },
        max_price:    { type: 'number', description: 'Maximum price in MXN pesos' },
        limit:        { type: 'number', minimum: 1, maximum: 20, default: 10, description: 'Number of results' },
        sort:         { type: 'string', enum: ['reciente','precio_asc','precio_desc','popular'], default: 'reciente', description: 'Sort order' },
        brand:        { type: 'string', description: 'Car brand (use with category=autos)' },
        year_from:    { type: 'number', description: 'Car year minimum (use with category=autos)' },
        year_to:      { type: 'number', description: 'Car year maximum (use with category=autos)' },
      },
    },
  },
  {
    name: 'get_listing',
    description: 'Get full details for a specific listing by ID, including trust signals, seller info, available payment methods, and checkout URLs.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Listing UUID from search_listings results' },
      },
    },
  },
  {
    name: 'get_checkout_options',
    description: 'Get ALL available payment methods for a listing in one call. Returns instant methods (MercadoPago, Stripe) with ready-to-use checkout URLs AND contact-first methods (bank transfer/SPEI with CLABE, cash on pickup, WhatsApp) with full instructions. Always call this before create_checkout so you can present the buyer their best options.',
    inputSchema: {
      type: 'object',
      required: ['listing_id'],
      properties: {
        listing_id:  { type: 'string', description: 'Listing UUID' },
        offer_id:    { type: 'string', description: 'Accepted offer UUID — session will use negotiated price' },
        buyer_email: { type: 'string', description: 'Buyer email (optional)' },
      },
    },
  },
  {
    name: 'create_checkout',
    description: 'Generate a payment checkout URL for a single specific instant payment method (MercadoPago or Stripe). Prefer get_checkout_options first to see all available methods including SPEI and cash options.',
    inputSchema: {
      type: 'object',
      required: ['listing_id'],
      properties: {
        listing_id:  { type: 'string', description: 'Listing UUID' },
        method:      { type: 'string', enum: ['mercadopago','stripe'], default: 'mercadopago', description: 'Payment method' },
        buyer_email: { type: 'string', description: 'Buyer email (optional, pre-fills checkout form)' },
        offer_id:    { type: 'string', description: 'Accepted offer UUID — uses negotiated price instead of list price' },
      },
    },
  },
  {
    name: 'make_offer',
    description: "Submit a price offer on a listing. The seller is notified by email and has 72 hours to accept, counter, or decline. If accepted, use create_checkout with the returned offer_id to buy at the negotiated price.",
    inputSchema: {
      type: 'object',
      required: ['listing_id', 'offer_amount', 'buyer_name', 'buyer_email'],
      properties: {
        listing_id:    { type: 'string', description: 'Listing UUID' },
        offer_amount:  { type: 'number', description: 'Your offer in MXN pesos (e.g. 1500 = $1,500)' },
        buyer_name:    { type: 'string', description: 'Your name' },
        buyer_email:   { type: 'string', description: 'Your email — seller responses arrive here' },
        message:       { type: 'string', description: 'Optional message to the seller' },
      },
    },
  },
  {
    name: 'get_shop',
    description: "Get a seller's shop profile and their active listings. Use to check a seller's trust level, location, and what else they're selling.",
    inputSchema: {
      type: 'object',
      required: ['shop_slug'],
      properties: {
        shop_slug: { type: 'string', description: 'Shop slug from listing.shop.slug in search results' },
        limit:     { type: 'number', minimum: 1, maximum: 20, default: 10, description: 'Number of listings to return' },
      },
    },
  },
  {
    name: 'check_availability',
    description: "Check available appointment slots for a listing. Returns the next available days and time slots from the seller's Cal.com calendar. Use before book_appointment to show the buyer what times are available.",
    inputSchema: {
      type: 'object',
      required: ['listing_id'],
      properties: {
        listing_id: { type: 'string', description: 'Listing UUID' },
        date_from:  { type: 'string', description: 'Start date to check (YYYY-MM-DD). Defaults to today.' },
        date_to:    { type: 'string', description: 'End date to check (YYYY-MM-DD). Defaults to 7 days from today.' },
        timezone:   { type: 'string', description: 'IANA timezone. Defaults to America/Mexico_City.' },
      },
    },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment slot for a listing — schedules a visit, test drive, or meeting with the seller. Returns booking confirmation with a unique ID.',
    inputSchema: {
      type: 'object',
      required: ['listing_id', 'start_time', 'buyer_name', 'buyer_email'],
      properties: {
        listing_id:  { type: 'string', description: 'Listing UUID' },
        start_time:  { type: 'string', description: 'ISO 8601 datetime of the desired slot (from check_availability)' },
        buyer_name:  { type: 'string', description: 'Full name of the person booking' },
        buyer_email: { type: 'string', description: 'Email to send booking confirmation to' },
        notes:       { type: 'string', description: 'Optional notes for the seller (e.g., "Interested in test driving")' },
        timezone:    { type: 'string', description: 'IANA timezone. Defaults to America/Mexico_City.' },
      },
    },
  },
  {
    name: 'get_buyer_trust',
    description: 'Check the OmniReputation trust score for a buyer by email address or Clerk user ID. Returns a 0–100 score, trust level (unverified/basic/trusted/verified/elite), and the individual signals that make up the score. Use before making a transaction recommendation to assess buyer trustworthiness.',
    inputSchema: {
      type: 'object',
      required: ['identifier'],
      properties: {
        identifier: { type: 'string', description: 'Email address (e.g. "juan@example.com") or Clerk user ID (e.g. "user_abc123")' },
      },
    },
  },
]

// ── Tool handlers ──────────────────────────────────────────────────────────────

async function handleSearchListings(args: Record<string, unknown>, baseUrl: string) {
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 20)

  let query = db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,clerk_user_id,metadata,mp_enabled)')
    .eq('status', 'active')
    .limit(limit)

  if (args.q)           query = query.textSearch('search_vector', String(args.q), { type: 'websearch', config: 'spanish' })
  if (args.category)    query = query.eq('category', String(args.category))
  if (args.listing_type) query = query.eq('listing_type', String(args.listing_type))
  if (args.state)       query = query.eq('state', String(args.state))
  if (args.location)    query = query.ilike('location', `%${args.location}%`)
  if (args.condition)   query = query.eq('condition', String(args.condition))
  if (args.min_price)   query = query.gte('price_cents', Math.round(Number(args.min_price) * 100))
  if (args.max_price)   query = query.lte('price_cents', Math.round(Number(args.max_price) * 100))
  if (args.brand)       query = query.ilike('metadata->>brand', `%${args.brand}%`)
  if (args.year_from)   query = query.gte('metadata->>year', String(args.year_from))
  if (args.year_to)     query = query.lte('metadata->>year', String(args.year_to))

  const sort = String(args.sort ?? 'reciente')
  const orderMap: Record<string, { column: string; ascending: boolean }> = {
    reciente:    { column: 'created_at', ascending: false },
    precio_asc:  { column: 'price_cents', ascending: true },
    precio_desc: { column: 'price_cents', ascending: false },
    popular:     { column: 'views', ascending: false },
  }
  const { column, ascending } = orderMap[sort] ?? orderMap.reciente
  query = query.order(column, { ascending })

  const { data, error } = await query
  if (error) return { isError: true, content: [{ type: 'text', text: `Search failed: ${error.message}` }] }

  const items = ((data ?? []) as Listing[]).map(l => toUcpListing(l, baseUrl))
  if (items.length === 0) return { content: [{ type: 'text', text: 'No listings found matching your search.' }] }

  const summary = items.map(item => {
    const price = item.price ? item.price.formatted : 'Precio a consultar'
    const flags = [
      item.actions.buy_now && '💳 comprar ahora',
      item.actions.make_offer && '🤝 hacer oferta',
      item.actions.escrow_available && '🛡️ pago protegido',
      item.trust.verified_seller && '✓ verificado',
    ].filter(Boolean).join(' · ')
    return `**${item.title}**\n${price} · ${item.location ?? item.state ?? 'México'} · ${item.condition ?? item.listing_type}\n${flags}\nID: \`${item.id}\` | ${item.url}`
  }).join('\n\n---\n\n')

  return { content: [{ type: 'text', text: `Found ${items.length} listings:\n\n${summary}` }, { type: 'text', text: JSON.stringify({ listings: items }, null, 2) }] }
}

async function handleGetListing(args: Record<string, unknown>, baseUrl: string) {
  const id = String(args.id ?? '')
  const { data, error } = await db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,clerk_user_id,metadata,mp_enabled)')
    .eq('id', id)
    .eq('status', 'active')
    .single()

  if (error || !data) return { isError: true, content: [{ type: 'text', text: `Listing ${id} not found.` }] }

  const item = toUcpListing(data as Listing, baseUrl)
  const details = [
    `# ${item.title}`,
    `**Precio:** ${item.price?.formatted ?? 'A consultar'}`,
    `**Condición:** ${item.condition ?? 'No especificada'} · **Tipo:** ${item.listing_type}`,
    `**Ubicación:** ${item.location ?? item.state ?? 'No especificada'}`,
    `**Vendedor:** ${item.shop.name}${item.trust.verified_seller ? ' ✓ verificado' : ''}`,
    '',
    `**Acciones:**`,
    item.actions.buy_now ? `✅ Comprar ahora` : `❌ Compra directa no disponible`,
    item.actions.make_offer ? `✅ Hacer oferta` : `❌ Ofertas no disponibles`,
    item.actions.escrow_required ? `🛡️ Pago protegido OBLIGATORIO` : item.actions.escrow_available ? `🛡️ Pago protegido disponible (opcional)` : '',
    `**Métodos:** ${[item.payment_methods.mercadopago && 'Mercado Pago', item.payment_methods.stripe && 'Stripe'].filter(Boolean).join(', ') || 'Ninguno configurado'}`,
    item.description ? `\n**Descripción:** ${item.description}` : '',
    `**URL:** ${item.url}`,
  ].filter(s => s !== '').join('\n')

  return { content: [{ type: 'text', text: details }, { type: 'text', text: JSON.stringify(item, null, 2) }] }
}

async function handleGetCheckoutOptions(args: Record<string, unknown>, baseUrl: string) {
  const body: Record<string, string> = { listing_id: String(args.listing_id ?? '') }
  if (args.offer_id)    body.offer_id    = String(args.offer_id)
  if (args.buyer_email) body.buyer_email = String(args.buyer_email)

  try {
    const res = await fetch(`${baseUrl}/api/ucp/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json() as { error?: string }
      return { isError: true, content: [{ type: 'text', text: `Failed to get checkout options: ${d.error ?? res.status}` }] }
    }

    const session = await res.json() as {
      price?: { formatted?: string; is_offer_price?: boolean }
      available_count?: number
      recommended_method?: string
      payment_options?: Array<{
        method: string; label: string; description: string; available: boolean;
        instant: boolean; checkout_url?: string; instructions?: string;
        contact_url?: string; bank_details?: { clabe: string; bank_name: string | null; account_holder: string | null }
        reason_unavailable?: string
      }>
      escrow?: { available: boolean; required: boolean; description: string }
    }

    const opts = session.payment_options ?? []
    const available = opts.filter(o => o.available)
    const unavailable = opts.filter(o => !o.available)

    const formatOption = (o: typeof opts[0]) => {
      const lines = [`**${o.label}** ${o.instant ? '⚡ Pago inmediato' : '📋 Coordinación requerida'}`]
      lines.push(o.description)
      if (o.checkout_url) lines.push(`→ Usar create_checkout con method="${o.method}" para generar el enlace de pago`)
      if (o.instructions) lines.push(`📋 ${o.instructions}`)
      if (o.bank_details) {
        lines.push(`🏦 CLABE: \`${o.bank_details.clabe}\``)
        if (o.bank_details.bank_name) lines.push(`   Banco: ${o.bank_details.bank_name}`)
        if (o.bank_details.account_holder) lines.push(`   Titular: ${o.bank_details.account_holder}`)
      }
      if (o.contact_url) lines.push(`📱 ${o.contact_url}`)
      return lines.join('\n')
    }

    const summary = [
      `## Opciones de pago para este anuncio`,
      session.price ? `**Precio:** ${session.price.formatted}${session.price.is_offer_price ? ' (precio negociado ✅)' : ''}` : '',
      session.escrow?.available ? `🛡️ ${session.escrow.description}` : '',
      '',
      `### Disponibles (${available.length})`,
      ...available.map(o => formatOption(o)),
      ...(unavailable.length > 0 ? [
        '',
        `### No disponibles`,
        ...unavailable.map(o => `~~${o.label}~~ — ${o.reason_unavailable ?? 'No disponible'}`),
      ] : []),
      '',
      session.recommended_method
        ? `✨ **Recomendado:** ${available.find(o => o.method === session.recommended_method)?.label ?? session.recommended_method}`
        : '⚠️ No hay métodos de pago disponibles para este anuncio.',
    ].filter(s => s !== '').join('\n\n')

    return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(session, null, 2) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }
}

async function handleCreateCheckout(args: Record<string, unknown>, baseUrl: string) {
  const method = String(args.method ?? 'mercadopago')
  const endpoint = method === 'stripe' ? `${baseUrl}/api/stripe/checkout` : `${baseUrl}/api/mp/checkout`

  const body: Record<string, string> = { listingId: String(args.listing_id) }
  if (args.buyer_email) body.buyerEmail = String(args.buyer_email)
  if (args.offer_id)    body.offerId    = String(args.offer_id)

  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json() as { checkoutUrl?: string; error?: string }
    if (!res.ok || !data.checkoutUrl) return { isError: true, content: [{ type: 'text', text: `Checkout failed: ${data.error ?? 'Unknown error'}` }] }
    return { content: [{ type: 'text', text: `✅ Checkout ready via ${method === 'stripe' ? 'Stripe' : 'Mercado Pago'}.\n\n**Abre este enlace para completar el pago:**\n${data.checkoutUrl}\n\nEl enlace es válido por 30 minutos.` }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }
}

async function handleMakeOffer(args: Record<string, unknown>, baseUrl: string) {
  const listingId  = String(args.listing_id ?? '')
  const amount     = Number(args.offer_amount)
  const buyerName  = String(args.buyer_name ?? '')
  const buyerEmail = String(args.buyer_email ?? '')

  if (!listingId || isNaN(amount) || !buyerName || !buyerEmail) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required fields: listing_id, offer_amount, buyer_name, buyer_email' }] }
  }

  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, title, price_cents, listing_type, status')
    .eq('id', listingId).eq('status', 'active').single()

  if (!listing) return { isError: true, content: [{ type: 'text', text: 'Listing not found or no longer active.' }] }
  if (listing.listing_type === 'digital') return { isError: true, content: [{ type: 'text', text: 'Digital products do not accept offers. Use create_checkout instead.' }] }

  const offerCents = Math.round(amount * 100)
  if (listing.price_cents && offerCents > listing.price_cents) {
    return { isError: true, content: [{ type: 'text', text: `Offer ($${amount}) exceeds list price ($${(listing.price_cents/100).toFixed(2)}). Use create_checkout to buy at list price.` }] }
  }

  const res = await fetch(`${baseUrl}/api/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: listingId, offer_amount_cents: offerCents, buyer_name: buyerName, buyer_email: buyerEmail, message: args.message }),
  })
  const data = await res.json() as { id?: string; error?: string }
  if (!res.ok || !data.id) return { isError: true, content: [{ type: 'text', text: `Offer failed: ${data.error ?? 'Unknown error'}` }] }

  return { content: [{ type: 'text', text: `✅ Offer submitted!\n\n**Offer ID:** \`${data.id}\`\n**Amount:** $${amount.toLocaleString('es-MX')} MXN\n**Listing:** ${listing.title}\n\nSeller has 72h to respond. Reply will arrive at ${buyerEmail}.\nIf accepted → call create_checkout with offer_id="${data.id}"` }] }
}

async function handleGetShop(args: Record<string, unknown>, baseUrl: string) {
  const slug  = String(args.shop_slug ?? '')
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 20)

  const { data: shop } = await db.from('marketplace_shops').select('*').eq('slug', slug).single()
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Shop "${slug}" not found.` }] }

  const { data: listingsData } = await db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,clerk_user_id,metadata,mp_enabled)')
    .eq('shop_id', shop.id).eq('status', 'active').order('created_at', { ascending: false }).limit(limit)

  const listings = ((listingsData ?? []) as Listing[]).map(l => toUcpListing(l, baseUrl))
  const isClaimed = !!(shop.clerk_user_id && !String(shop.clerk_user_id).startsWith('pending:'))

  const profile = [
    `# ${shop.name}${shop.verified ? ' ✓ verificado' : ''}`,
    shop.description ? `\n${shop.description}\n` : '',
    `**Ubicación:** ${shop.location ?? 'No especificada'}`,
    `**Tienda reclamada:** ${isClaimed ? 'Sí' : 'No'}`,
    `**URL:** ${baseUrl}/s/${shop.slug}`,
    `\n**${listings.length} anuncios activos:**`,
    ...listings.map(item => `• ${item.title} — ${item.price?.formatted ?? 'A consultar'} (ID: \`${item.id}\`)`),
  ].filter(s => s !== '').join('\n')

  return { content: [{ type: 'text', text: profile }, { type: 'text', text: JSON.stringify({ shop, listings }, null, 2) }] }
}

async function getShopCalcom(listingId: string): Promise<{
  apiKey: string; eventTypeId: number; bookingUrl: string; listing: { title: string; category: string | null }
} | null> {
  const { data } = await db
    .from('marketplace_listings')
    .select('title, category, marketplace_shops!inner(calcom_api_key, metadata)')
    .eq('id', listingId)
    .eq('status', 'active')
    .maybeSingle()
  if (!data) return null
  const shop = data.marketplace_shops as unknown as { calcom_api_key: string | null; metadata: Record<string, unknown> | null }
  if (!shop.calcom_api_key) return null
  const calcomSettings = (shop.metadata?.settings as Record<string, unknown> | undefined)?.calcom as {
    event_type_id?: number; booking_url?: string; connected?: boolean
  } | undefined
  if (!calcomSettings?.connected || !calcomSettings.event_type_id) return null
  return {
    apiKey: shop.calcom_api_key,
    eventTypeId: calcomSettings.event_type_id,
    bookingUrl: calcomSettings.booking_url ?? '',
    listing: { title: data.title, category: data.category },
  }
}

// ── Link-only scheduling fallback ─────────────────────────────────────────────

async function getShopSchedulingLinks(listingId: string): Promise<{ bookingUrl: string; label: string; title: string } | null> {
  const { data } = await db
    .from('marketplace_listings')
    .select('title, marketplace_shops!inner(metadata)')
    .eq('id', listingId)
    .eq('status', 'active')
    .maybeSingle()
  if (!data) return null
  const shop = data.marketplace_shops as unknown as { metadata: Record<string, unknown> | null }
  const schedulingMeta = ((shop.metadata?.settings as Record<string, unknown> | undefined)?.scheduling ?? {}) as { links?: Array<{ label: string; url: string }> }
  const firstLink = schedulingMeta.links?.[0]
  if (!firstLink?.url) return null
  return { bookingUrl: firstLink.url, label: firstLink.label || 'Reservas en línea', title: data.title }
}

async function handleCheckAvailability(args: Record<string, unknown>) {
  const listingId = String(args.listing_id ?? '')
  if (!listingId) return { isError: true, content: [{ type: 'text', text: 'listing_id is required' }] }

  const cal = await getShopCalcom(listingId)
  if (!cal) {
    // Try link-only fallback — seller pasted a booking link without an API key
    const linkSchedule = await getShopSchedulingLinks(listingId)
    if (!linkSchedule) {
      return { isError: true, content: [{ type: 'text', text: 'This listing does not have scheduling enabled. Use the booking_url from get_listing to book directly.' }] }
    }
    return {
      content: [{
        type: 'text',
        text: [
          `## Agendamiento — ${linkSchedule.title}`,
          '',
          `This seller uses a **manual booking link** (${linkSchedule.label}). Real-time availability checking is not available, but you can book directly:`,
          '',
          `🔗 **${linkSchedule.bookingUrl}**`,
          '',
          'Open the link to see available times and complete your booking. The seller will receive a confirmation notification.',
          '',
          `> **Note:** If the buyer prefers AI-assisted booking with real-time availability, suggest the seller connect their Cal.com API key in their shop settings.`,
        ].join('\n'),
      }, {
        type: 'text',
        text: JSON.stringify({ listing_id: listingId, mode: 'link_only', booking_url: linkSchedule.bookingUrl }, null, 2),
      }],
    }
  }

  const today    = new Date()
  const dateFrom = String(args.date_from ?? today.toISOString().slice(0, 10))
  const dateTo   = String(args.date_to ?? new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10))
  const timezone = String(args.timezone ?? 'America/Mexico_City')

  let slots: Record<string, Array<{ time: string }>>
  try {
    slots = await getCalAvailableSlots(cal.apiKey, cal.eventTypeId, dateFrom, dateTo, timezone)
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Could not fetch availability: ${String(err)}` }] }
  }

  const days = Object.entries(slots).filter(([, daySlots]) => daySlots.length > 0)
  if (days.length === 0) {
    return { content: [{ type: 'text', text: `No available slots for **${cal.listing.title}** between ${dateFrom} and ${dateTo}.\n\nTry a wider date range or contact the seller directly.` }] }
  }

  const summary = [
    `## Disponibilidad para ${cal.listing.title}`,
    `📅 **${days.length} día${days.length > 1 ? 's' : ''} disponibles** (${dateFrom} → ${dateTo})`,
    '',
    ...days.map(([date, daySlots]) => {
      const d = new Date(date)
      const dayLabel = d.toLocaleDateString('es-MX', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone })
      const times = daySlots.slice(0, 8).map(s => {
        const t = new Date(s.time)
        return t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
      }).join(' · ')
      return `**${dayLabel}**\n${times}${daySlots.length > 8 ? ` +${daySlots.length - 8} más` : ''}`
    }),
    '',
    '→ Use `book_appointment` with the `start_time` in ISO 8601 format to confirm a slot.',
  ].join('\n')

  return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify({ listing_id: listingId, slots }, null, 2) }] }
}

async function handleBookAppointment(args: Record<string, unknown>) {
  const listingId  = String(args.listing_id ?? '')
  const startTime  = String(args.start_time ?? '')
  const buyerName  = String(args.buyer_name ?? '')
  const buyerEmail = String(args.buyer_email ?? '')
  const timezone   = String(args.timezone ?? 'America/Mexico_City')

  if (!listingId || !startTime || !buyerName || !buyerEmail) {
    return { isError: true, content: [{ type: 'text', text: 'Required: listing_id, start_time, buyer_name, buyer_email' }] }
  }

  const cal = await getShopCalcom(listingId)
  if (!cal) {
    // Try link-only fallback
    const linkSchedule = await getShopSchedulingLinks(listingId)
    if (!linkSchedule) {
      return { isError: true, content: [{ type: 'text', text: 'This listing does not have scheduling enabled.' }] }
    }
    return {
      content: [{
        type: 'text',
        text: [
          `## Booking Required — ${linkSchedule.title}`,
          '',
          `This seller manages their own booking via ${linkSchedule.label}. I cannot book on your behalf, but here's the direct link:`,
          '',
          `🔗 **${linkSchedule.bookingUrl}**`,
          '',
          `Share this link with the buyer so they can select their preferred time. The confirmation will be sent to their email.`,
        ].join('\n'),
      }],
    }
  }

  let booking
  try {
    booking = await createCalBooking(
      cal.apiKey,
      cal.eventTypeId,
      startTime,
      buyerName,
      buyerEmail,
      timezone,
      args.notes ? String(args.notes) : undefined
    )
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Booking failed: ${String(err)}` }] }
  }

  const startDate = new Date(booking.startTime)
  const formattedDate = startDate.toLocaleString('es-MX', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  })
  const agendarLabel = cal.listing.category === 'autos' ? 'prueba de manejo'
    : cal.listing.category === 'inmuebles' ? 'visita' : 'cita'

  const summary = [
    `## ✅ ${agendarLabel.charAt(0).toUpperCase() + agendarLabel.slice(1)} agendada`,
    '',
    `**Anuncio:** ${cal.listing.title}`,
    `**Fecha:** ${formattedDate}`,
    `**Confirmación enviada a:** ${buyerEmail}`,
    `**Booking ID:** \`${booking.uid}\``,
    '',
    `El vendedor también recibió una notificación. Revisa tu correo para más detalles.`,
  ].join('\n')

  return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(booking, null, 2) }] }
}

async function handleGetBuyerTrust(args: Record<string, unknown>) {
  const identifier = String(args.identifier ?? '').trim()
  if (!identifier) {
    return { isError: true, content: [{ type: 'text', text: 'identifier is required (email or Clerk user ID)' }] }
  }

  const isClerkId = identifier.startsWith('user_')
  const isEmail   = !isClerkId && identifier.includes('@')
  if (!isClerkId && !isEmail) {
    return { isError: true, content: [{ type: 'text', text: 'identifier must be an email address or Clerk user ID (user_xxx)' }] }
  }

  const trust = await computeTrustScore(identifier)

  const earned   = trust.signals.filter(s => s.earned)
  const unearned = trust.signals.filter(s => !s.earned)

  const summary = [
    `## OmniReputation — ${trust.level_label}`,
    `**Score:** ${trust.score}/100 · **Nivel:** ${trust.level}`,
    `**Buyer:** ${identifier}`,
    '',
    `### Señales obtenidas (${earned.length})`,
    ...earned.map(s => `✅ ${s.label} (+${s.points} pts) — ${s.description}`),
    ...(unearned.length > 0 ? [
      '',
      `### Señales no obtenidas (${unearned.length})`,
      ...unearned.map(s => `⬜ ${s.label} (+${s.points} pts) — ${s.description}`),
    ] : []),
    '',
    `*Calculado: ${trust.computed_at}*`,
  ].join('\n')

  return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(trust, null, 2) }] }
}

// ── MCP method dispatcher ─────────────────────────────────────────────────────

async function handleMcpMethod(method: string, params: Record<string, unknown> | undefined, baseUrl: string) {
  // Standard MCP lifecycle
  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'miyagisanchez', version: '1.0.0' },
      instructions: 'Miyagi Sánchez marketplace for Mexico. Workflow: search_listings → get_listing → get_checkout_options (payment methods: MP, Stripe, SPEI, cash, WhatsApp) → create_checkout or make_offer. If the listing has scheduling: check_availability → book_appointment. Use get_buyer_trust(email) before recommending a transaction.',
    }
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    return {}
  }

  if (method === 'tools/list') {
    return { tools: TOOLS }
  }

  if (method === 'tools/call') {
    const name = String((params?.name as string | undefined) ?? '')
    const args = (params?.arguments as Record<string, unknown> | undefined) ?? {}

    switch (name) {
      case 'search_listings':      return { content: (await handleSearchListings(args, baseUrl)).content }
      case 'get_listing':          return { content: (await handleGetListing(args, baseUrl)).content }
      case 'get_checkout_options': return { content: (await handleGetCheckoutOptions(args, baseUrl)).content }
      case 'create_checkout':      return { content: (await handleCreateCheckout(args, baseUrl)).content }
      case 'make_offer':           return { content: (await handleMakeOffer(args, baseUrl)).content }
      case 'get_shop':             return { content: (await handleGetShop(args, baseUrl)).content }
      case 'check_availability':   return { content: (await handleCheckAvailability(args)).content }
      case 'book_appointment':     return { content: (await handleBookAppointment(args)).content }
      case 'get_buyer_trust':      return { content: (await handleGetBuyerTrust(args)).content }
      default:                     return null  // will become MethodNotFound error
    }
  }

  return null  // MethodNotFound
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

// GET — minimal server info for browser / discovery
export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const base  = `${proto}://${host}`

  return NextResponse.json(
    {
      name: 'miyagisanchez',
      version: '1.0.0',
      protocol: 'MCP/2024-11-05',
      transport: 'http-json-rpc',
      instructions: 'POST JSON-RPC 2.0 requests to this endpoint.',
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      manifest: `${base}/api/ucp/manifest`,
    },
    { headers: CORS }
  )
}

// POST — JSON-RPC 2.0 dispatcher
export async function POST(req: NextRequest) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const rl = await checkRateLimit('mcp', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      err(null, -32029, 'Rate limit exceeded — too many requests'),
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const host    = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto   = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await req.json() as JsonRpcRequest | JsonRpcRequest[]
  } catch {
    return NextResponse.json(
      err(null, -32700, 'Parse error'),
      { status: 400, headers: CORS }
    )
  }

  // Support batch requests
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(r => dispatchOne(r, baseUrl)))
    const responses = results.filter((r): r is JsonRpcResponse => r !== null)
    return NextResponse.json(responses, { headers: CORS })
  }

  const response = await dispatchOne(body, baseUrl)
  if (response === null) {
    // Notification — no response per JSON-RPC spec
    return new Response(null, { status: 204, headers: CORS })
  }
  return NextResponse.json(response, { headers: CORS })
}

async function dispatchOne(req: JsonRpcRequest, baseUrl: string): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null

  if (req.jsonrpc !== '2.0' || !req.method) {
    return err(id, -32600, 'Invalid Request')
  }

  // Notifications (no id) — don't send response
  const isNotification = req.id === undefined

  try {
    const result = await handleMcpMethod(req.method, req.params, baseUrl)
    if (result === null) {
      if (isNotification) return null
      return err(id, -32601, `Method not found: ${req.method}`)
    }
    if (isNotification) return null
    return ok(id, result)
  } catch (e) {
    if (isNotification) return null
    return err(id, -32603, `Internal error: ${String(e)}`)
  }
}
