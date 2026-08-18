import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { usSellerCtaHref } from '../lib/seller-acquisition'
import { buildUsMarketPageConfig } from '../app/(shell)/vende/_components/page-config'
import { resolveSellerSignupMarket } from '../lib/seller-signup-market'
import { validatePlatformDictionaries } from '../lib/dictionary-contract'

const ROOT = path.resolve(import.meta.dirname, '..')
const source = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), 'utf8')
const load = (relativePath: string) => JSON.parse(source(relativePath))

const publishTarget = (href: string) =>
  decodeURIComponent(new URL(href, 'https://miyagisanchez.com').searchParams.get('redirect_url') ?? '')

test.describe('US seller recruiting · signed-out /sell', () => {
  test('the CTA converts on sign-up and carries the immutable market through it', () => {
    const href = usSellerCtaHref({ utm_source: 'newsletter', v: 'b' })

    expect(new URL(href, 'https://miyagisanchez.com').pathname).toBe('/sign-up')

    // `market` is the whole point: a shop's market cannot be changed after
    // creation, so if it does not survive account creation the seller silently
    // gets a Mexican shop — the exact defect us-marketplace S5.2 was built to stop.
    const target = new URL(publishTarget(href), 'https://miyagisanchez.com')
    expect(target.pathname).toBe('/sell')
    expect(target.searchParams.get('market')).toBe('us')
    expect(resolveSellerSignupMarket(target.searchParams.get('market'))).toBe('us')
    expect(target.searchParams.get('from')).toBe('us')
    expect(target.searchParams.get('v')).toBe('b')
    expect(target.searchParams.get('utm_source')).toBe('newsletter')
  })

  test('both dictionaries carry a US block and the pair stays in contract', () => {
    const es = load('locales/es.json')
    const en = load('locales/en.json')

    expect(en.sellerAcquisition.us).toBeTruthy()
    expect(es.sellerAcquisition.us).toBeTruthy()
    expect(validatePlatformDictionaries(es, en)).toEqual([])
  })

  test('the page is authored US truth, not the Mexican page translated', () => {
    const en = load('locales/en.json')
    const config = buildUsMarketPageConfig(en.sellerAcquisition, {})

    expect(config.pageId).toBe('us')

    // Every claim on the page is rendered from these fields, so this is where a
    // Mexico-only promise would leak into a US recruiting surface. `admitMarketCheckout`
    // refuses MercadoPago, SPEI and cash on a US checkout, and refuses `shipping`
    // outright because there is no US carrier rate seam — so none of those words
    // may appear here whatever the translation says.
    const rendered = JSON.stringify([
      config.title, config.lead, config.proofPoints, config.steps, config.faqs,
      config.heroStats, config.heroValues, config.closingTitle, config.closingBody,
    ]).toLowerCase()
    for (const impossible of ['mercadopago', 'mercado pago', 'spei', 'peso', 'mxn', 'méxico', 'mexico']) {
      expect(rendered, `US page must not promise ${impossible}`).not.toContain(impossible)
    }
    expect(rendered).toContain('stripe')
    expect(rendered).toContain('usd')

    // Both CTAs convert on sign-up — the routing change this page exists to serve.
    for (const cta of [config.primaryCta, config.closingCta]) {
      expect(cta).not.toBeNull()
      expect(new URL(cta!.href, 'https://miyagisanchez.com').pathname).toBe('/sign-up')
    }
  })

  test('/sell renders the US landing signed-out and still renders the wizard signed-in', () => {
    const page = source('app/(shell)/sell/page.tsx')

    // The wizard is load-bearing: ~25 `redirect('/sell')` call sites across the
    // merchant hub and four payment-connect return routes land on this page. So
    // the assertion is POSITIONAL, not "both strings appear" — the landing has to
    // sit inside the signed-out branch, above the guard that resolves an existing
    // shop, and the wizard has to stay below it. Rendering the landing after that
    // guard would show a recruiting page to a merchant trying to publish.
    const signedOutBranch = page.indexOf('if (!user) {')
    const signedInGuard = page.indexOf('const existingShop = await getMySeller()')
    const landingRender = page.indexOf('buildUsMarketPageConfig(')
    const wizardRender = page.search(/<SellWizard\s/)

    expect(signedOutBranch).toBeGreaterThan(-1)
    expect(signedInGuard).toBeGreaterThan(-1)
    expect(landingRender).toBeGreaterThan(-1)
    expect(wizardRender).toBeGreaterThan(-1)

    expect(page).toContain('SellerAcquisitionPage')
    expect(landingRender).toBeGreaterThan(signedOutBranch)
    expect(landingRender).toBeLessThan(signedInGuard)
    expect(wizardRender).toBeGreaterThan(signedInGuard)
  })

  test('one effective locale drives the page — the preference is never overridden by the market', () => {
    const page = source('app/(shell)/sell/page.tsx')

    // Cross-family review (PR 389, Codex) caught this: the pre-seller US branch
    // hardcoded `locale="en"`, so a signup who had explicitly chosen Spanish still
    // got an English wizard. A visitor with no shop has no Medusa market, so the
    // validated SIGNUP market defaults the language — and the stored preference
    // still overrides it, exactly as it does once a shop exists.
    expect(page).toContain('resolveSellerLocale({')
    expect(page).toContain('market: signupMarket,')
    expect(page).not.toMatch(/locale="en"/)
    expect(page).not.toMatch(/getDictionary\('en'\)/)

    // Spanish stays the identity case here too: no boundary, no dictionary.
    expect(page).toContain('if (existingShop || !sellerCopyBoundaryNeeded(locale)) return content')

    // Market picks the PAGE, locale picks the LANGUAGE — the recruiting landing is
    // still chosen by market alone, so a US visitor reading Spanish gets the US
    // page in Spanish rather than the Mexican one.
    expect(page).toContain("if (signupMarket !== 'us') return content")
    expect(page).toContain('getOverriddenDictionary(locale)')
  })
})
