import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// US-3 (Sprint 3) — the anchor benchmark table. Locked copy from COPY-BRIEF.md §4 (approved 2026-06-25).
// Pure fs read (no server) so it runs in the always-on api gate.
type BenchmarkRow = { label: string; miyagi: string; mercadoLibre: string; shopify: string }
type Benchmark = {
  title: string
  lead: string
  rowHeader: string
  columns: string[]
  rows: BenchmarkRow[]
  verified: string
  verifiedLabel: string
  footnote: string
}
const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')) as {
  sellerAcquisition: { anchor: { benchmark?: Benchmark } }
}
const benchmark = es.sellerAcquisition.anchor.benchmark

test.describe('seller acquisition · anchor benchmark table (US-3)', () => {
  test('benchmark block exists with all three platform columns', () => {
    expect(benchmark, 'anchor.benchmark must exist').toBeTruthy()
    expect(benchmark!.columns).toHaveLength(3)
    expect(benchmark!.columns[0]).toContain('Miyagi')
    expect(benchmark!.columns).toContain('Mercado Libre')
    expect(benchmark!.columns).toContain('Shopify')
  })

  test('has the full eight-row comparison, each row covering all three platforms', () => {
    expect(benchmark!.rows).toHaveLength(8)
    for (const row of benchmark!.rows) {
      expect(row.label.length, `row "${row.label}" needs a label`).toBeGreaterThan(0)
      expect(row.miyagi.length, `row "${row.label}" needs a Miyagi cell`).toBeGreaterThan(0)
      expect(row.mercadoLibre.length, `row "${row.label}" needs a Mercado Libre cell`).toBeGreaterThan(0)
      expect(row.shopify.length, `row "${row.label}" needs a Shopify cell`).toBeGreaterThan(0)
    }
  })

  test('uses the 0%-platform-commission framing, never "0 costos"/"sin costos"', () => {
    const commissionRow = benchmark!.rows.find((r) => /comisi[oó]n/i.test(r.label))
    expect(commissionRow, 'a "Comisión por venta" row must exist').toBeTruthy()
    expect(commissionRow!.miyagi).toContain('0%')
    expect(commissionRow!.miyagi.toLowerCase()).toContain('comisión de plataforma')

    const blob = JSON.stringify(benchmark)
    expect(blob).not.toContain('0 costos')
    expect(blob).not.toContain('sin costos')
    expect(blob).not.toContain('gratis total')
  })

  test('competitor cells show ranges, not single cherry-picked numbers', () => {
    const blob = benchmark!.rows.map((r) => `${r.mercadoLibre} ${r.shopify}`).join(' ')
    // At least one en-dash range and one approximate (~) marker across the competitor cells.
    expect(blob).toMatch(/–/)
    expect(blob).toContain('~')
  })

  test('benchmark is sourced and date-stamped (re-verify before publish)', () => {
    expect(benchmark!.verified).toBe('25 de junio de 2026')
    expect(benchmark!.footnote).toContain('25 de junio de 2026')
    expect(benchmark!.footnote).toContain('Mercado Libre')
    expect(benchmark!.footnote).toContain('Shopify')
  })
})
