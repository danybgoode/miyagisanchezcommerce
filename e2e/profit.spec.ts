import { test, expect } from '@playwright/test'
import {
  computeOrderMargins,
  computeSkuMargins,
  formatCents,
  formatPct,
  type ProfitEvent,
  type ProfitOrderInfo,
} from '../lib/profit'

/**
 * Profit Analyzer · Sprint 1 · US-3 — pure margin math (`lib/profit.ts`).
 * The dashboard's numbers must match hand math; missing pieces are named
 * PENDING facts, never assumed $0.
 */

const ev = (over: Partial<ProfitEvent>): ProfitEvent => ({
  id: 'e', order_id: 'o1', order_line_id: 'l1', source: 'native',
  event_type: 'revenue', amount_cents: 0, currency_code: 'mxn',
  captured_at: '2026-07-06T12:00:00Z', ...over,
})

const orders: ProfitOrderInfo[] = [
  {
    id: 'o1', display_id: 101, created_at: '2026-07-06T12:00:00Z', currency_code: 'mxn', source: 'native',
    items: [{ id: 'l1', product_id: 'p1', variant_id: 'v1', title: 'Taza', quantity: 2 }],
  },
  {
    id: 'o2', display_id: 102, created_at: '2026-07-05T12:00:00Z', currency_code: 'mxn', source: 'mercadolibre',
    items: [{ id: 'l2', product_id: 'p2', variant_id: 'v2', title: 'Playera', quantity: 1 }],
  },
]

test.describe('profit · computeOrderMargins (US-3)', () => {
  test('hand math: revenue − fee − shipping − cogs, per order', () => {
    const rows = computeOrderMargins([
      ev({ id: 'e1', event_type: 'revenue', amount_cents: 20000 }),
      ev({ id: 'e2', event_type: 'cogs_snapshot', amount_cents: 9000 }),
      ev({ id: 'e3', event_type: 'shipping_cost', amount_cents: 12000, order_line_id: null }),
      ev({ id: 'e4', order_id: 'o2', order_line_id: 'l2', source: 'mercadolibre', event_type: 'revenue', amount_cents: 30100 }),
      ev({ id: 'e5', order_id: 'o2', order_line_id: 'l2', source: 'mercadolibre', event_type: 'ml_fee', amount_cents: 4214 }),
    ], orders)

    expect(rows).toHaveLength(2)
    const [o1, o2] = rows // newest first
    expect(o1.order_id).toBe('o1')
    expect(o1.margin_cents).toBe(20000 - 9000 - 12000) // -1000: a real silent-loss case
    expect(o1.margin_pct).toBeCloseTo(-0.05)
    expect(o1.pending).toEqual([]) // all three native pieces present

    expect(o2.margin_cents).toBe(30100 - 4214)
    expect(o2.pending).toEqual(['cogs', 'shipping']) // honest partials, fee present
  })

  test('missing pieces are named pending facts, never $0-assumed complete', () => {
    const [row] = computeOrderMargins([ev({ event_type: 'revenue', amount_cents: 10000 })], orders)
    expect(row.pending).toEqual(['cogs', 'shipping'])
    expect(row.margin_cents).toBe(10000) // margin over what exists
  })

  test('an ML order without a parsed fee reports ml_fee pending', () => {
    const [row] = computeOrderMargins(
      [ev({ order_id: 'o2', order_line_id: 'l2', source: 'mercadolibre', event_type: 'revenue', amount_cents: 5000 })],
      orders,
    )
    expect(row.pending).toContain('ml_fee')
  })

  test('zero-revenue rows have null margin_pct (no divide-by-zero)', () => {
    const [row] = computeOrderMargins([ev({ event_type: 'cogs_snapshot', amount_cents: 100 })], orders)
    expect(row.margin_pct).toBeNull()
  })
})

test.describe('profit · computeSkuMargins (US-3)', () => {
  test('aggregates line events per product, excluding order-level shipping', () => {
    const rows = computeSkuMargins([
      ev({ id: 'e1', event_type: 'revenue', amount_cents: 20000 }),
      ev({ id: 'e2', event_type: 'cogs_snapshot', amount_cents: 9000 }),
      ev({ id: 'e3', event_type: 'shipping_cost', amount_cents: 12000, order_line_id: null }),
      ev({ id: 'e4', order_id: 'o2', order_line_id: 'l2', source: 'mercadolibre', event_type: 'revenue', amount_cents: 30100 }),
      ev({ id: 'e5', order_id: 'o2', order_line_id: 'l2', source: 'mercadolibre', event_type: 'ml_fee', amount_cents: 4214 }),
    ], orders)

    const playera = rows.find((r) => r.product_id === 'p2')!
    expect(playera.margin_cents).toBe(30100 - 4214)
    const taza = rows.find((r) => r.product_id === 'p1')!
    expect(taza.margin_cents).toBe(20000 - 9000) // shipping excluded by design
    expect(taza.units).toBe(2)
    // Highest revenue first.
    expect(rows[0].product_id).toBe('p2')
  })

  test('a line-less event on a single-product order attributes to that product', () => {
    const rows = computeSkuMargins(
      [ev({ order_id: 'o2', order_line_id: null, source: 'mercadolibre', event_type: 'revenue', amount_cents: 1000 })],
      orders,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].product_id).toBe('p2')
  })

  test('unattributable events land in the honest "sin asignar" bucket, last', () => {
    const multi: ProfitOrderInfo = {
      id: 'o3', display_id: 103, created_at: null, currency_code: 'mxn', source: 'mercadolibre',
      items: [
        { id: 'a', product_id: 'pA', variant_id: null, title: 'A', quantity: 1 },
        { id: 'b', product_id: 'pB', variant_id: null, title: 'B', quantity: 1 },
      ],
    }
    const rows = computeSkuMargins([
      ev({ order_id: 'o3', order_line_id: 'a', event_type: 'revenue', amount_cents: 100 }),
      ev({ order_id: 'o3', order_line_id: null, event_type: 'revenue', amount_cents: 999999 }),
    ], [multi])
    expect(rows[rows.length - 1].product_id).toBe('unassigned')
  })
})

test.describe('profit · formatters', () => {
  test('formatCents renders es-MX currency; formatPct handles null', () => {
    expect(formatCents(185050)).toContain('1,850.50')
    expect(formatPct(0.421)).toBe('42.1%')
    expect(formatPct(null)).toBe('—')
  })
})

// ── Route guard — agnostic to the live flag value (LEARNINGS: assert BOTH
// flag states). Flag OFF ⇒ the page notFound()s (404); flag ON ⇒ an anonymous
// request redirects to sign-in (settles 200 after redirects).
test.describe('profit · /shop/manage/profit gate (US-3)', () => {
  test('anonymous request settles 200 (sign-in) or 404 (flag off) — never a 5xx', async ({ request }) => {
    const res = await request.get('/shop/manage/profit', { headers: { Accept: 'text/html' } })
    expect([200, 404]).toContain(res.status())
  })
})
