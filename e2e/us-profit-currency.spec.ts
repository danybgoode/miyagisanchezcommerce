import { expect, test } from '@playwright/test'
import {
  computeOrderMargins,
  computeSkuMargins,
  computeSkuMarginsByChannel,
  formatCents,
  normalizeCurrency,
  totalsByCurrency,
  type ProfitEvent,
  type ProfitOrderInfo,
} from '../lib/profit'

/**
 * us-marketplace S4.3 (D16) — "every profit aggregation key includes currency; USD and
 * MXN are displayed separately and never summed."
 *
 * Cents are not a unit. 1000 MXN cents and 1000 USD cents are different amounts of
 * money, and adding them yields a number that is not a price in any currency. The
 * failure is silent: the total still renders and still looks plausible.
 */

const event = (over: Partial<ProfitEvent>): ProfitEvent => ({
  id: 'e1', order_id: 'o_mx', order_line_id: 'li_mx', source: 'native',
  event_type: 'revenue', amount_cents: 10_000, currency_code: 'mxn',
  captured_at: '2026-08-01T00:00:00Z', ...over,
})

const order = (over: Partial<ProfitOrderInfo>): ProfitOrderInfo => ({
  id: 'o_mx', display_id: 1, created_at: '2026-08-01T00:00:00Z', currency_code: 'mxn',
  source: 'native',
  items: [{ id: 'li_mx', product_id: 'prod_1', variant_id: 'var_1', title: 'Mug', quantity: 1 }],
  ...over,
})

/** The same SKU sold in both markets — the case the whole story is about. */
const twoMarkets = {
  events: [
    event({ id: 'e_mx', order_id: 'o_mx', order_line_id: 'li_mx', amount_cents: 10_000, currency_code: 'mxn' }),
    event({ id: 'e_us', order_id: 'o_us', order_line_id: 'li_us', amount_cents: 2_500, currency_code: 'usd' }),
  ],
  orders: [
    order({}),
    order({
      id: 'o_us', display_id: 2, currency_code: 'usd',
      items: [{ id: 'li_us', product_id: 'prod_1', variant_id: 'var_1', title: 'Mug', quantity: 1 }],
    }),
  ],
}

test.describe('profit aggregation is currency-keyed', () => {
  test('one SKU sold in two currencies is TWO rows, never one summed row', () => {
    const rows = computeSkuMargins(twoMarkets.events, twoMarkets.orders)
    expect(rows).toHaveLength(2)

    const byCurrency = Object.fromEntries(rows.map((r) => [r.currency_code, r.revenue_cents]))
    expect(byCurrency).toEqual({ mxn: 10_000, usd: 2_500 })
    // The number that must never appear: 12500, pesos and dollars added together.
    expect(rows.some((r) => r.revenue_cents === 12_500)).toBe(false)
  })

  test('the per-channel variant splits by currency too', () => {
    const rows = computeSkuMarginsByChannel(twoMarkets.events, twoMarkets.orders)
    expect(rows.map((r) => r.currency_code).sort()).toEqual(['mxn', 'usd'])
  })

  test('even the unassigned bucket splits — an honest single-currency total beats a mixed one', () => {
    const rows = computeSkuMargins(
      [
        event({ id: 'a', order_id: 'o_x', order_line_id: null, currency_code: 'mxn', amount_cents: 100 }),
        event({ id: 'b', order_id: 'o_y', order_line_id: null, currency_code: 'usd', amount_cents: 200 }),
      ],
      [
        order({ id: 'o_x', items: [{ id: 'l1', product_id: 'p1', variant_id: null, title: 'A', quantity: 1 }, { id: 'l2', product_id: 'p2', variant_id: null, title: 'B', quantity: 1 }] }),
        order({ id: 'o_y', currency_code: 'usd', items: [{ id: 'l3', product_id: 'p3', variant_id: null, title: 'C', quantity: 1 }, { id: 'l4', product_id: 'p4', variant_id: null, title: 'D', quantity: 1 }] }),
      ],
    )
    const unassigned = rows.filter((r) => r.product_id === 'unassigned')
    expect(unassigned).toHaveLength(2)
    expect(unassigned.map((r) => r.currency_code).sort()).toEqual(['mxn', 'usd'])
  })

  test('order rows carry their own currency', () => {
    const rows = computeOrderMargins(twoMarkets.events, twoMarkets.orders)
    expect(Object.fromEntries(rows.map((r) => [r.order_id, r.currency_code])))
      .toEqual({ o_mx: 'mxn', o_us: 'usd' })
  })
})

test.describe('dashboard totals', () => {
  test('are one set PER CURRENCY, never a single mixed figure', () => {
    const totals = totalsByCurrency(computeOrderMargins(twoMarkets.events, twoMarkets.orders))
    expect(totals).toHaveLength(2)
    expect(Object.fromEntries(totals.map((t) => [t.currency_code, t.revenue])))
      .toEqual({ mxn: 10_000, usd: 2_500 })
    expect(totals.every((t) => t.orders === 1)).toBe(true)
  })

  test('lead with the seller\'s principal market, stably', () => {
    const totals = totalsByCurrency(computeOrderMargins(twoMarkets.events, twoMarkets.orders))
    expect(totals[0].currency_code).toBe('mxn')
    // Deterministic across renders even when revenue ties.
    const tied = totalsByCurrency([
      { currency_code: 'usd', order_id: 'a', display_id: null, created_at: null, source: 'native', title: 'x', revenue_cents: 100, fees_cents: 0, shipping_cents: 0, cogs_cents: 0, margin_cents: 100, margin_pct: 1, pending: [] },
      { currency_code: 'mxn', order_id: 'b', display_id: null, created_at: null, source: 'native', title: 'y', revenue_cents: 100, fees_cents: 0, shipping_cents: 0, cogs_cents: 0, margin_cents: 100, margin_pct: 1, pending: [] },
    ])
    expect(tied.map((t) => t.currency_code)).toEqual(['mxn', 'usd'])
  })

  test('a seller with NO sales still gets one zero group, not an empty dashboard', () => {
    // Found by the Codex pass on frontend PR 360: returning `[]` here made the summary
    // cards vanish rather than read zero, deleting the dashboard's existing empty
    // state. A zero is a fact; an absent card is a missing feature.
    const totals = totalsByCurrency([])
    expect(totals).toHaveLength(1)
    expect(totals[0]).toEqual({
      currency_code: 'mxn', revenue: 0, fees: 0, shipping: 0, cogs: 0,
      margin: 0, margin_pct: null, orders: 0,
    })
  })

  test('one currency means one group — the row label only appears when it disambiguates', () => {
    // `$` is the symbol for BOTH markets (es-MX: `$1,250`; en-US: `$12.50`), so the
    // UI shows a currency column exactly when there is more than one group. A
    // Mexico-only seller must not gain a column of `MXN` labels for no reason.
    expect(totalsByCurrency(computeOrderMargins([twoMarkets.events[0]], [twoMarkets.orders[0]]))).toHaveLength(1)
    expect(totalsByCurrency(computeOrderMargins(twoMarkets.events, twoMarkets.orders)).length).toBeGreaterThan(1)
  })

  test('a Mexico-only seller sees exactly ONE group — the page is unchanged for everyone today', () => {
    const totals = totalsByCurrency(computeOrderMargins([twoMarkets.events[0]], [twoMarkets.orders[0]]))
    expect(totals).toHaveLength(1)
    expect(totals[0]).toMatchObject({ currency_code: 'mxn', revenue: 10_000, orders: 1 })
  })

  test('margin % is computed per currency, not once over a mixed total', () => {
    const totals = totalsByCurrency([
      { currency_code: 'mxn', order_id: 'a', display_id: null, created_at: null, source: 'native', title: 'x', revenue_cents: 1000, fees_cents: 0, shipping_cents: 0, cogs_cents: 500, margin_cents: 500, margin_pct: 0.5, pending: [] },
      { currency_code: 'usd', order_id: 'b', display_id: null, created_at: null, source: 'native', title: 'y', revenue_cents: 1000, fees_cents: 0, shipping_cents: 0, cogs_cents: 900, margin_cents: 100, margin_pct: 0.1, pending: [] },
    ])
    expect(Object.fromEntries(totals.map((t) => [t.currency_code, t.margin_pct])))
      .toEqual({ mxn: 0.5, usd: 0.1 })
  })
})

test.describe('formatting follows the money, not the viewer', () => {
  test('USD renders in en-US, MXN in es-MX', () => {
    // Intl will happily render USD under es-MX — as `USD 12.50`, with a Mexican
    // decimal convention and a currency code where a US seller expects `$12.50`.
    expect(formatCents(1250, 'usd')).toBe('$12.50')
    expect(formatCents(1250, 'mxn')).toMatch(/12\.50/)
    expect(formatCents(1250, 'usd')).not.toMatch(/USD\s/)
  })

  test('the default is unchanged for every existing caller', () => {
    expect(formatCents(1250)).toBe(formatCents(1250, 'mxn'))
  })

  test('normalizeCurrency documents its default rather than guessing per call site', () => {
    expect(normalizeCurrency('USD')).toBe('usd')
    expect(normalizeCurrency('  mxn ')).toBe('mxn')
    for (const empty of [null, undefined, '', '   ']) {
      expect(normalizeCurrency(empty)).toBe('mxn')
    }
  })
})
