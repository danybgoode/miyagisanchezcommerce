import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { sellerTrustPrompt } from '../lib/seller-acquisition'
import { buildPromoterPageConfig } from '../app/(shell)/vende/_components/page-config'

// Locked es-MX copy from COPY-BRIEF.md (Sprint 1, approved 2026-06-25). These guards keep the
// distrust framing, internal jargon, and un-accented offenders from creeping back into the
// seller-acquisition landing copy.
const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')) as {
  sellerAcquisition: Record<string, unknown> & {
    shared: {
      trustPrompt: string
      selfCheck: { title: string; body: string }
      heroTrustLine: string
    }
    anchor: {
      heroValues: { value: string; label: string; icon: string }[]
      premiumFeatures: { title: string; lead: string; items: { icon: string; label: string; sub: string }[] }
      benchmark: { example: { rows: unknown[]; footnotes: string[]; punchline: string } }
    }
  }
}
const sa = es.sellerAcquisition
const blob = JSON.stringify(sa)

test.describe('seller acquisition · es-MX copy guards', () => {
  test('no distrust framing or internal jargon remains', () => {
    const banned = ['No pedimos fe', 'No nos creas', 'vaporware', 'atribuci', 'para medir qu']
    for (const phrase of banned) {
      expect(blob, `banned phrase "${phrase}" must be gone`).not.toContain(phrase)
    }
  })

  test('no un-accented offenders remain (legit plurals like comisiones are allowed)', () => {
    // Match the offender ONLY as a standalone word — a trailing letter (e.g. comisiones,
    // publicaciones) is the correctly un-accented Spanish plural and is allowed.
    const offenders = ['comision', 'publicacion', 'pagina', 'Mexico', 'Que tipo']
    for (const tok of offenders) {
      const re = new RegExp(`${tok}(?!\\p{L})`, 'iu')
      expect(blob, `un-accented offender "${tok}" must not appear as a standalone word`).not.toMatch(re)
    }
  })

  test('self-check block carries the self-verify invitation', () => {
    expect(sa.shared.selfCheck.title).toBe('Compruébalo tú mismo')
    // Launch polish (§D): the body now points at the copy-paste prompt block (Sprint 2),
    // not the old "No tienes que creernos…" paragraph.
    expect(sa.shared.selfCheck.body).toContain('Copia el prompt y pégalo en tu IA')
  })

  test('trust prompt is a directive, cost-comparing template', () => {
    expect(sa.shared.trustPrompt).toContain('{url}')
    expect(sa.shared.trustPrompt).toContain('Mercado Libre')
    expect(sa.shared.trustPrompt).toContain('Shopify')
  })

  test('sellerTrustPrompt substitutes the page URL and keeps the comparison instruction', () => {
    const anchor = sellerTrustPrompt('vende', sa.shared.trustPrompt)
    expect(anchor).toContain('https://miyagisanchez.com/vende')
    expect(anchor).not.toContain('{url}')
    expect(anchor).toContain('Mercado Libre')
    expect(anchor).toContain('Shopify')

    const creators = sellerTrustPrompt('creadores', sa.shared.trustPrompt)
    expect(creators).toContain('https://miyagisanchez.com/vende/creadores')

    const servicios = sellerTrustPrompt('servicios', sa.shared.trustPrompt)
    expect(servicios).toContain('https://miyagisanchez.com/vende/servicios')
  })

  // ── launch polish (seller-landing-launch-polish, Sprint 1) ──────────────────────────────

  test('brand voice: no bare "Miyagi" (only "Miyagi Sánchez" or "miyagisanchez.com")', () => {
    expect(blob, 'bare "Miyagi" must be "Miyagi Sánchez" or "miyagisanchez.com"').not.toMatch(
      /Miyagi(?!\s*Sánchez)/,
    )
  })

  test('brand voice: our word is "marketplace", never "mercado" (brand names stay)', () => {
    // Strip the legit brand names + the benchmark JSON key, then any remaining "mercado" is ours.
    const cleaned = blob
      .replace(/Mercado Libre/g, '')
      .replace(/MercadoPago/g, '')
      .replace(/"mercadoLibre"/g, '')
    expect(cleaned, 'our-word "mercado" must be "marketplace"').not.toMatch(/mercado/i)
  })

  test('removed clutter/distrust lines are gone (§C/§E/§F/§G)', () => {
    const removed = [
      'no es promesa a futuro',
      'Hecho para negocios reales',
      'El Mundial no espera',
      'Entra antes de que la demanda',
    ]
    for (const phrase of removed) {
      expect(blob, `removed line "${phrase}" must be gone`).not.toContain(phrase)
    }
  })

  test('hero trust line is staged for the prompt block (§B)', () => {
    expect(sa.shared.heroTrustLine).toContain('copia el prompt')
    expect(sa.shared.heroTrustLine).toMatch(/Claude.*Gemini.*ChatGPT/)
  })

  test('anchor hero value list has 3 value/label/icon items (§B)', () => {
    expect(sa.anchor.heroValues).toHaveLength(3)
    for (const v of sa.anchor.heroValues) {
      expect(v.value.length).toBeGreaterThan(0)
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.icon.startsWith('iconoir-')).toBe(true)
    }
  })

  test('anchor premium-features grid has 6 items (§F)', () => {
    expect(sa.anchor.premiumFeatures.title.length).toBeGreaterThan(0)
    expect(sa.anchor.premiumFeatures.items).toHaveLength(6)
    for (const it of sa.anchor.premiumFeatures.items) {
      expect(it.label.length).toBeGreaterThan(0)
      expect(it.sub.length).toBeGreaterThan(0)
      expect(it.icon.startsWith('iconoir-')).toBe(true)
    }
  })

  test('benchmark worked-example has 3 platform rows + 4 footnotes (§H)', () => {
    const ex = sa.anchor.benchmark.example
    expect(ex.rows).toHaveLength(3)
    expect(ex.footnotes).toHaveLength(4)
    expect(ex.punchline).toContain('Mercado Libre')
  })
})

test.describe('promoter landing · CTA + wording sweep (promoter-funnel-v2 S1 · US-1.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promoterCopy = (sa as any).promotor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullCopy = sa as any

  test('no stale "subdomain is free for everyone" claim remains in the glossary', () => {
    const subdomainEntry = promoterCopy.glossary.find((g: { title: string }) => g.title === 'Subdominio')
    expect(subdomainEntry.body).not.toContain('gratis para todos')
    expect(subdomainEntry.body).toContain('$199')
    expect(subdomainEntry.body).toContain('GRATIS el primer año')
  })

  test('a not-yet-bound visitor gets the apply CTA, never the dead-ended workspace CTA', () => {
    const config = buildPromoterPageConfig(fullCopy, { customDomainPriceMxn: 499, enabled: true, isBoundPromoter: false })
    expect(config.primaryCta?.label).toBe('Aplica para ser promotor')
    expect(config.primaryCta?.label).not.toBe('Abrir mi panel para cerrar')
    // Never a dead link: the apply CTA anchors to the on-page teaser, not a route.
    expect(config.primaryCta?.href).toBe('#promotor-aplica')
    expect(config.applyTeaser?.id).toBe('promotor-aplica')
  })

  test('a bound promoter keeps the real close-workspace CTA', () => {
    const config = buildPromoterPageConfig(fullCopy, { customDomainPriceMxn: 499, enabled: true, isBoundPromoter: true })
    expect(config.primaryCta?.label).toBe('Abrir mi panel para cerrar')
    expect(config.primaryCta?.href).toBe('/promotor/cerrar')
    expect(config.applyTeaser).toBeUndefined()
  })
})
