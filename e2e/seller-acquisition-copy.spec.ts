import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { sellerTrustPrompt } from '../lib/seller-acquisition'

// Locked es-MX copy from COPY-BRIEF.md (Sprint 1, approved 2026-06-25). These guards keep the
// distrust framing, internal jargon, and un-accented offenders from creeping back into the
// seller-acquisition landing copy.
const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')) as {
  sellerAcquisition: Record<string, unknown> & {
    shared: { trustPrompt: string; selfCheck: { title: string; body: string } }
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
    expect(sa.shared.selfCheck.body).toContain('No tienes que creernos')
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
})
