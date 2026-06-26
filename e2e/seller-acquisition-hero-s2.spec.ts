import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  buildAnchorPageConfig,
  buildCreatorPageConfig,
  buildLocalBusinessPageConfig,
  buildServicesPageConfig,
} from '../app/(shell)/vende/_components/page-config'
import { sellerTrustPrompt } from '../lib/seller-acquisition'

// Sprint 2 (US-2) — the redesigned hero contract, asserted at the pure config seam (no server, runs in
// the always-on api gate). The *rendered* facts an api spec can't see — the visible PromptBlock, the copy
// button working, eyebrow badges gone, no horizontal overflow — live in the browser project
// (seller-acquisition-anchor.browser.spec.ts + seller-acquisition-mobile.browser.spec.ts).

const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8'))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const copy = es.sellerAcquisition as any

test.describe('seller acquisition · redesigned hero config (US-2)', () => {
  test('anchor hero leads with the value list (0% · IA · Premium), each with an icon', () => {
    const config = buildAnchorPageConfig(copy, {})
    expect(config.heroValues, 'anchor must carry heroValues').toBeTruthy()
    expect(config.heroValues).toHaveLength(3)
    for (const value of config.heroValues!) {
      expect(value.value.length, 'value needs a headline').toBeGreaterThan(0)
      expect(value.label.length, 'value needs a label').toBeGreaterThan(0)
      expect(value.icon, 'each anchor value carries an icon').toMatch(/^iconoir-/)
    }
    // The three sharpest props, in order.
    expect(config.heroValues![0].value).toBe('0%')
    expect(config.heroValues![1].label.toLowerCase()).toContain('claude')
    expect(config.heroValues![2].label.toLowerCase()).toContain('premium')
  })

  test('persona heroes fall back to their three stats (no heroValues override)', () => {
    for (const build of [buildCreatorPageConfig, buildLocalBusinessPageConfig, buildServicesPageConfig]) {
      const config = build(copy, {})
      expect(config.heroValues, 'personas keep stats, not the anchor value list').toBeUndefined()
      expect(config.heroStats.length).toBeGreaterThanOrEqual(3)
    }
  })

  test('every hero feeds the PromptBlock a directive prompt + copy labels', () => {
    for (const build of [
      buildAnchorPageConfig,
      buildCreatorPageConfig,
      buildLocalBusinessPageConfig,
      buildServicesPageConfig,
    ]) {
      const config = build(copy, {})
      // The PromptBlock renders this prompt visibly; it must carry the page URL + the cost comparison.
      expect(config.trustPrompt).toContain('miyagisanchez.com')
      expect(config.trustPrompt).toContain('Mercado Libre')
      expect(config.trustPrompt).toContain('Shopify')
      expect(config.copyLabel.length).toBeGreaterThan(0)
      expect(config.copiedLabel.length).toBeGreaterThan(0)
    }
  })

  test('the anchor hero trust line is the shared launch line (no per-page URL)', () => {
    const config = buildAnchorPageConfig(copy, {})
    expect(config.trustLine).toBe(copy.shared.heroTrustLine)
    expect(config.trustLine.toLowerCase()).toContain('compruébalo tú mismo')
  })

  test('the bespoke mundial hero feeds its PromptBlock the per-page directive prompt', () => {
    // mundial/page.tsx computes this and passes it to <PromptBlock>.
    const prompt = sellerTrustPrompt('mundial', copy.shared.trustPrompt)
    expect(prompt).toContain('https://miyagisanchez.com/vende/mundial')
    expect(prompt).toContain('Mercado Libre')
    expect(prompt).toContain('Shopify')
  })
})
