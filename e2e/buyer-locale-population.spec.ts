import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  deriveBuyerLocalePopulation,
  hardcodedPresentationCandidates,
  literalUiCandidates,
  serializeBuyerLocalePopulation,
} from '../scripts/derive-buyer-locale-population'

const ROOT = path.resolve(import.meta.dirname, '..')

test.describe('buyer locale population · generated, never hand-counted', () => {
  test('the direct buyer population is re-derived and remains non-empty', () => {
    const population = deriveBuyerLocalePopulation(ROOT)
    expect(population.direct.length).toBe(67)
    expect(population.direct).toContain('app/(shell)/mx/l/page.tsx')
    expect(population.direct).toContain('app/(shell)/checkout/CheckoutExperience.tsx')
  })

  test('the checked manifest is byte-identical to a fresh derivation', () => {
    const expected = serializeBuyerLocalePopulation(deriveBuyerLocalePopulation(ROOT))
    const checked = readFileSync(path.join(ROOT, 'locales/buyer-population.json'), 'utf8')
    expect(checked).toBe(expected)
  })

  test('the invitation page is named separately and cannot masquerade as an open buyer route', () => {
    const population = deriveBuyerLocalePopulation(ROOT)
    expect(population.invitation).toEqual(['app/(us-site)/us/page.tsx'])
    expect(population.direct.some((file) => file.includes('/us/'))).toBe(false)
  })

  test('every render-closure file is classified exactly once', () => {
    const population = deriveBuyerLocalePopulation(ROOT)
    const classified = [
      ...population.copyClassification.dictionaryConsuming,
      ...population.copyClassification.noLiteralUiCopy,
      ...population.copyClassification.needsExtraction.map(({ file }) => file),
    ].sort()
    expect(classified).toEqual(population.closure)
    expect(new Set(classified).size).toBe(classified.length)
  })

  test('the only literal exemption is the referral URL template, named exactly', () => {
    const population = deriveBuyerLocalePopulation(ROOT)
    expect(population.copyClassification.explicitExemptions).toEqual([{
      file: 'app/(shell)/account/referrals/ReferralsClient.tsx',
      candidates: ['{0}/?ref={1}'],
      reason: 'technical_url_template',
    }])
  })

  test('the buyer render closure has no unlocalized literal UI copy', () => {
    const population = deriveBuyerLocalePopulation(ROOT)
    expect(population.copyClassification.needsExtraction).toEqual([])
  })

  test('classification follows rendered literals through expressions instead of accepting source-level evasions', () => {
    const source = `
      const HOISTED = 'Comprar ahora'
      const STATE = true ? 'Cargando…' : 'Enviar oferta'
      export function Fixture({ status }: { status: string }) {
        return <><button>{status === 'paid' ? HOISTED : STATE}</button><style>{\`button { color: red; }\`}</style></>
      }
    `
    expect(literalUiCandidates(source)).toEqual(['Cargando…', 'Comprar ahora', 'Enviar oferta'])
  })

  test('buyer presentation formatting has no hardcoded Mexico locale or timezone', () => {
    const population = deriveBuyerLocalePopulation(ROOT)
    expect(population.presentationFormatting.explicitExemptions).toEqual([])
    expect(population.presentationFormatting.hardcoded).toEqual([])
  })

  test('presentation guard recognizes Intl, toLocale, and timezone evasions', () => {
    const source = `
      const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
      const date = value.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
    `
    expect(hardcodedPresentationCandidates(source)).toEqual([
      "Intl.NumberFormat('es-MX')",
      "timeZone: 'America/Mexico_City'",
      "value.toLocaleDateString('es-MX')",
    ])
  })
})
