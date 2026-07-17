import { expect, test } from '@playwright/test'
import { computeShopifyCost, formatMxn } from '../lib/cost-comparator'
import { shopifyRatesFromDataset, lineSourceHint } from '../lib/cost-comparator-dataset'
import type { ComparatorDataset } from '../lib/cost-comparator-dataset'
// Import attribute required for the same reason e2e/cost-comparator-dataset.spec.ts
// needs it — see lib/cost-comparator-dataset.ts's file header.
import baselineDataset from '../lib/cost-comparator-dataset.json' with { type: 'json' }

const baseline = baselineDataset as ComparatorDataset

// Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.3) — the
// route-level `api` spec: an anonymous GET (no browser, no auth) must render the
// sourced verified date + the key figures, and a query-string prefill must produce
// EXACTLY the number `lib/cost-comparator.ts` computes for the same inputs — no
// drift between the page's server render and the pure model.
//
// The comparator dataset can, in principle, carry live Supabase overrides
// (US-1.2) — but the prod `platform_copy_overrides` table doesn't exist yet (owed
// to Daniel, see the epic README), so `getComparatorDataset()` always falls back
// to the baseline JSON today. If/when that changes, a live-overridden figure would
// make the "known input → lib's exact number" assertion below environment-
// dependent; it compares against the BASELINE computation on purpose, and is
// written to fail loudly (not silently) if that ever drifts.

test.describe('comparador · route renders anonymously', () => {
  test('GET /comparador renders the sourced verified date + platform picker', async ({ request }) => {
    const res = await request.get('/comparador', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    expect(html).toContain('data-testid="comparador-verified-date"')
    expect(html).toContain('Datos verificados')
    expect(html).toContain('data-testid="comparador-platform-select"')
    expect(html).toContain('data-testid="comparador-volume-input"')
    expect(html).toContain('data-testid="comparador-aov-input"')
    // No login prompt anywhere — the route is anonymous by design.
    expect(html).not.toContain('data-testid="sign-in-prompt"')
  })

  test('renders both totals and all three premium-app toggles', async ({ request }) => {
    const res = await request.get('/comparador', { headers: { Accept: 'text/html' } })
    const html = await res.text()
    expect(html).toContain('data-testid="comparador-monthly-competitor-total"')
    expect(html).toContain('data-testid="comparador-monthly-miyagi-total"')
    expect(html).toContain('data-testid="comparador-annual-competitor-total"')
    expect(html).toContain('data-testid="comparador-annual-miyagi-total"')
    expect(html).toContain('data-testid="comparador-app-liveChat"')
    expect(html).toContain('data-testid="comparador-app-coupons"')
    expect(html).toContain('data-testid="comparador-app-offers"')
    expect(html).toContain('Incluido en Miyagi')
  })
})

test.describe('comparador · a known prefill produces the lib\'s exact number', () => {
  test('platform=shopify&tier=basico&volume=100&aov=500 matches computeShopifyCost on the baseline dataset', async ({ request }) => {
    const volume = 100
    const aov = 500
    const res = await request.get(`/comparador?platform=shopify&tier=basico&volume=${volume}&aov=${aov}`, {
      headers: { Accept: 'text/html' },
    })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    const expected = computeShopifyCost({ volumeMonthly: volume, aovMxn: aov }, 'basico', shopifyRatesFromDataset(baseline))

    // The rendered monthly total (no apps/overrides selected on first load) must equal
    // the pure lib's number for the identical inputs, formatted the SAME way the page
    // does (`formatMxn` — the single es-MX currency formatter both share).
    expect(html).toContain(`data-testid="comparador-monthly-competitor-total"`)
    expect(html).toContain(formatMxn(expected.monthlyTotalMxn))
    expect(html).toContain(formatMxn(expected.annualTotalMxn))
  })
})

// codex cross-review (should-fix) — the footer claims every figure "muestra su
// fuente al pasar el cursor"; prove the rendered line for the Shopify plan tier
// actually carries that source+date in its `title` attribute, not just the
// pure lineSourceHint() function in isolation (cost-comparator-dataset.spec.ts).
test.describe('comparador · sourced-figure hover tooltip (codex should-fix)', () => {
  test('the Shopify plan line carries its dataset source + verifiedAt in a title attribute', async ({ request }) => {
    const res = await request.get('/comparador?platform=shopify&tier=basico', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    const expectedHint = lineSourceHint(baseline, 'shopify', 'plan', { shopifyTier: 'basico' })
    expect(expectedHint).toContain('Fuente:')

    const input = html.match(/<input[^>]*data-testid="comparador-line-shopify-plan"[^>]*>/)?.[0] ?? ''
    expect(input).not.toBe('')
    expect(input).toContain(`title="${expectedHint.replace(/"/g, '&quot;')}"`)
  })
})
