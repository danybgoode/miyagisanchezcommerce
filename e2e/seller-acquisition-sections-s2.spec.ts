import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  buildAnchorPageConfig,
  buildCreatorPageConfig,
  buildServicesPageConfig,
} from '../app/(shell)/vende/_components/page-config'

// Sprint 2 (US-2) — section redesign contract at the pure config seam (api gate). The rendered facts
// (premium grid renders in place of the social block, the worked-example table reflows, router cards
// carry no eyebrow badge) live in seller-acquisition-anchor-s3.browser.spec.ts.

const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8'))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const copy = es.sellerAcquisition as any

test.describe('seller acquisition · section redesign (US-2)', () => {
  test('anchor carries the premium-features grid (6 icon cards) that replaces the social block', () => {
    const config = buildAnchorPageConfig(copy, {})
    expect(config.premiumFeatures, 'anchor must carry premiumFeatures').toBeTruthy()
    expect(config.premiumFeatures!.items.length).toBeGreaterThanOrEqual(6)
    for (const item of config.premiumFeatures!.items) {
      expect(item.icon).toMatch(/^iconoir-/)
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.sub.length).toBeGreaterThan(0)
    }
    // The sharpest premium props are present.
    const blob = JSON.stringify(config.premiumFeatures).toLowerCase()
    expect(blob).toContain('boletos')
    expect(blob).toContain('sorteos')
    expect(blob).toContain('suscripciones')
  })

  test('persona pages keep their social-proof stats (no premium grid)', () => {
    for (const build of [buildCreatorPageConfig, buildServicesPageConfig]) {
      const config = build(copy, {})
      expect(config.premiumFeatures, 'personas keep the social block, not the premium grid').toBeUndefined()
      expect(config.socialStats.length).toBeGreaterThan(0)
    }
  })

  test('anchor benchmark carries a worked take-home example (table + punchline + footnotes)', () => {
    const config = buildAnchorPageConfig(copy, {})
    const example = config.benchmark!.example
    expect(example, 'benchmark.example must exist').toBeTruthy()
    expect(example!.columns).toHaveLength(4)
    expect(example!.rows.length).toBeGreaterThanOrEqual(3)
    // miyagisanchez.com is the first (highlighted) row, with the best take-home.
    expect(example!.rows[0].platform).toContain('miyagisanchez.com')
    expect(example!.rows[0].commission).toContain('$0')
    // The punchline carries the take-home delta vs Mercado Libre.
    expect(example!.punchline).toContain('Mercado Libre')
    expect(example!.footnotes.length).toBeGreaterThanOrEqual(3)
  })
})
