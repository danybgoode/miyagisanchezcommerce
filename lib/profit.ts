/**
 * Profit margin math — the PURE seam the profit dashboard reads
 * (profit-analyzer S1 · US-3). No React, no `server-only`, no network: the
 * `/shop/manage/profit` server page fetches the backend's raw ledger
 * (`GET /store/sellers/me/profit`) and everything from raw events → per-order
 * / per-SKU margin rows happens here, spec'd in `e2e/profit.spec.ts`.
 *
 * Honesty rules (mirror the ledger's own): a missing piece is a named PENDING
 * fact ("envío pendiente"), never an assumed $0 — margins are computed over
 * the pieces that exist, and each row says which are missing. Amounts are
 * integer centavos throughout (the ledger's own unit).
 */

export type ProfitEventType = 'revenue' | 'ml_fee' | 'shipping_cost' | 'cogs_snapshot'
export type ProfitSource = 'mercadolibre' | 'native'

export interface ProfitEvent {
  id: string
  order_id: string
  order_line_id: string | null
  source: ProfitSource
  event_type: ProfitEventType
  amount_cents: number
  currency_code: string
  captured_at: string
}

export interface ProfitOrderItem {
  id: string
  product_id: string | null
  variant_id: string | null
  title: string | null
  quantity: number | null
}

export interface ProfitOrderInfo {
  id: string
  display_id: number | null
  created_at: string | null
  currency_code: string | null
  source: ProfitSource
  items: ProfitOrderItem[]
}

export type PendingPiece = 'cogs' | 'shipping' | 'ml_fee'

export interface OrderMarginRow {
  order_id: string
  display_id: number | null
  created_at: string | null
  source: ProfitSource
  title: string
  revenue_cents: number
  fees_cents: number
  shipping_cents: number
  cogs_cents: number
  /** revenue − fees − shipping − cogs, over the pieces that exist. */
  margin_cents: number
  /** margin / revenue; null when revenue is 0 (margin % is meaningless). */
  margin_pct: number | null
  /** The named missing pieces this row is honest about. */
  pending: PendingPiece[]
}

export interface SkuMarginRow {
  product_id: string
  title: string
  units: number
  revenue_cents: number
  fees_cents: number
  cogs_cents: number
  /** Per-SKU margin EXCLUDES shipping (an order-level cost) — stated in the UI. */
  margin_cents: number
  margin_pct: number | null
}

const sum = (events: ProfitEvent[], type: ProfitEventType) =>
  events.filter((e) => e.event_type === type).reduce((acc, e) => acc + (Number.isFinite(e.amount_cents) ? e.amount_cents : 0), 0)

/**
 * One margin row per order that has at least one ledger event. Pending
 * pieces: `cogs` when no snapshot landed (seller had no cost recorded at sale
 * time), `shipping` when no shipping-cost event exists yet (label not bought /
 * ML shipment cost unparsed — pickup orders also show it; the copy says
 * "registrado"), `ml_fee` when an ML order's fee couldn't be parsed.
 */
export function computeOrderMargins(events: ProfitEvent[], orders: ProfitOrderInfo[]): OrderMarginRow[] {
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const byOrder = new Map<string, ProfitEvent[]>()
  for (const e of events) {
    const list = byOrder.get(e.order_id) ?? []
    list.push(e)
    byOrder.set(e.order_id, list)
  }

  const rows: OrderMarginRow[] = []
  for (const [orderId, orderEvents] of byOrder) {
    const info = orderById.get(orderId)
    const source: ProfitSource = info?.source ?? orderEvents[0]?.source ?? 'native'
    const revenue = sum(orderEvents, 'revenue')
    const fees = sum(orderEvents, 'ml_fee')
    const shipping = sum(orderEvents, 'shipping_cost')
    const cogs = sum(orderEvents, 'cogs_snapshot')

    const pending: PendingPiece[] = []
    if (!orderEvents.some((e) => e.event_type === 'cogs_snapshot')) pending.push('cogs')
    if (!orderEvents.some((e) => e.event_type === 'shipping_cost')) pending.push('shipping')
    if (source === 'mercadolibre' && !orderEvents.some((e) => e.event_type === 'ml_fee')) pending.push('ml_fee')

    const margin = revenue - fees - shipping - cogs
    rows.push({
      order_id: orderId,
      display_id: info?.display_id ?? null,
      created_at: info?.created_at ?? null,
      source,
      title: info?.items?.[0]?.title ?? '—',
      revenue_cents: revenue,
      fees_cents: fees,
      shipping_cents: shipping,
      cogs_cents: cogs,
      margin_cents: margin,
      margin_pct: revenue > 0 ? margin / revenue : null,
      pending,
    })
  }

  // Newest first (created_at desc, unknowns last) — the dashboard's order.
  return rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

/**
 * Line-level events (revenue / ml_fee / cogs) aggregated per product.
 * Attribution: by the event's `order_line_id` → the order's item → product;
 * events without a line id (ML index-qualified lines) attribute to the
 * order's product when the order has exactly ONE distinct product — else
 * they land in the honest "sin asignar" bucket rather than a guessed SKU.
 * Shipping (order-level) is deliberately excluded — stated in the UI.
 */
export function computeSkuMargins(events: ProfitEvent[], orders: ProfitOrderInfo[]): SkuMarginRow[] {
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const buckets = new Map<string, SkuMarginRow>()

  const bucketFor = (productId: string, title: string): SkuMarginRow => {
    const existing = buckets.get(productId)
    if (existing) return existing
    const fresh: SkuMarginRow = {
      product_id: productId, title, units: 0,
      revenue_cents: 0, fees_cents: 0, cogs_cents: 0, margin_cents: 0, margin_pct: null,
    }
    buckets.set(productId, fresh)
    return fresh
  }

  for (const e of events) {
    if (e.event_type === 'shipping_cost') continue
    const info = orderById.get(e.order_id)
    const items = info?.items ?? []

    let item: ProfitOrderItem | undefined
    if (e.order_line_id) {
      item = items.find((i) => i.id === e.order_line_id)
    } else {
      const distinctProducts = new Set(items.map((i) => i.product_id).filter(Boolean))
      if (distinctProducts.size === 1) item = items[0]
    }
    const productId = item?.product_id ?? 'unassigned'
    const title = item?.title ?? 'Sin asignar'
    const bucket = bucketFor(productId, title)

    if (e.event_type === 'revenue') bucket.revenue_cents += e.amount_cents
    else if (e.event_type === 'ml_fee') bucket.fees_cents += e.amount_cents
    else if (e.event_type === 'cogs_snapshot') bucket.cogs_cents += e.amount_cents

    if (e.event_type === 'revenue') {
      const qty = item?.quantity
      bucket.units += typeof qty === 'number' && Number.isFinite(qty) ? qty : 0
    }
  }

  const rows = [...buckets.values()]
  for (const row of rows) {
    row.margin_cents = row.revenue_cents - row.fees_cents - row.cogs_cents
    row.margin_pct = row.revenue_cents > 0 ? row.margin_cents / row.revenue_cents : null
  }
  // Highest revenue first; the unassigned bucket always last.
  return rows.sort((a, b) =>
    (a.product_id === 'unassigned' ? 1 : 0) - (b.product_id === 'unassigned' ? 1 : 0)
    || b.revenue_cents - a.revenue_cents)
}

/** es-MX centavos → "$1,850.50" (matches the manage-area convention). */
export function formatCents(cents: number, currency = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
}

/** 0.4213 → "42.1%"; null → "—". */
export function formatPct(pct: number | null): string {
  return pct == null ? '—' : `${(pct * 100).toFixed(1)}%`
}
