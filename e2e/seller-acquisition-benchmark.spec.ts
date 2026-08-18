import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// US-3 (Sprint 3) — the anchor benchmark table. Locked copy from COPY-BRIEF.md §4 (approved 2026-06-25).
// Pure fs read (no server) so it runs in the always-on api gate.
//
// Rows carry a POSITIONAL `cells` array parallel to `columns` (the named
// miyagi/mercadoLibre/shopify fields were dropped when `/us/operators` started
// rendering the same component against a Shopify/Amazon column set). The
// structural assertions below are therefore driven by `columns.length` and apply
// to every market's table; the wording assertions stay per-table.
type Benchmark = {
  title: string
  lead: string
  rowHeader: string
  columns: string[]
  rows: { label: string; cells: string[] }[]
  verified: string
  verifiedLabel: string
  footnote: string
}
const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')) as {
  sellerAcquisition: { anchor: { benchmark?: Benchmark } }
  partnersRecruiting: { landing: { benchmark?: Benchmark } }
}
const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8')) as {
  partnersRecruiting: { landing: { benchmark?: Benchmark } }
}
const benchmark = es.sellerAcquisition.anchor.benchmark

/** Every table, whichever market it serves, must be rectangular and fully filled. */
function assertWellFormed(table: Benchmark | undefined, name: string) {
  expect(table, `${name} must exist`).toBeTruthy()
  expect(table!.columns.length, `${name} needs at least two columns`).toBeGreaterThan(1)
  expect(table!.columns[0]).toContain('Miyagi')
  expect(table!.rows.length, `${name} needs rows`).toBeGreaterThan(0)
  for (const row of table!.rows) {
    expect(row.label.length, `${name} row "${row.label}" needs a label`).toBeGreaterThan(0)
    expect(row.cells, `${name} row "${row.label}" must have one cell per column`).toHaveLength(table!.columns.length)
    for (const [index, cell] of row.cells.entries()) {
      expect(cell.length, `${name} row "${row.label}" cell ${index} is empty`).toBeGreaterThan(0)
    }
  }
}

test.describe('seller acquisition · anchor benchmark table (US-3)', () => {
  test('benchmark block exists with all three platform columns', () => {
    assertWellFormed(benchmark, 'anchor.benchmark')
    expect(benchmark!.columns).toHaveLength(3)
    expect(benchmark!.columns).toContain('Mercado Libre')
    expect(benchmark!.columns).toContain('Shopify')
  })

  test('has the full eight-row comparison, each row covering all three platforms', () => {
    expect(benchmark!.rows).toHaveLength(8)
  })

  test('uses the 0%-platform-commission framing, never "0 costos"/"sin costos"', () => {
    const commissionRow = benchmark!.rows.find((r) => /comisi[oó]n/i.test(r.label))
    expect(commissionRow, 'a "Comisión por venta" row must exist').toBeTruthy()
    expect(commissionRow!.cells[0]).toContain('0%')
    expect(commissionRow!.cells[0].toLowerCase()).toContain('comisión de plataforma')

    const blob = JSON.stringify(benchmark)
    expect(blob).not.toContain('0 costos')
    expect(blob).not.toContain('sin costos')
    expect(blob).not.toContain('gratis total')
  })

  test('competitor cells show ranges, not single cherry-picked numbers', () => {
    const blob = benchmark!.rows.map((r) => r.cells.slice(1).join(' ')).join(' ')
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

test.describe('US operator benchmark table', () => {
  for (const [locale, dict] of [['en', en], ['es', es]] as const) {
    test(`${locale}: compares us against the US reference stack, well-formed`, () => {
      const table = dict.partnersRecruiting.landing.benchmark
      assertWellFormed(table, `partnersRecruiting.landing.benchmark (${locale})`)
      // The whole point of the US table is to borrow the reader's existing Shopify
      // and Amazon heuristics — a table missing either is not doing its job.
      expect(table!.columns).toContain('Shopify')
      expect(table!.columns).toContain('Amazon')
    })

    test(`${locale}: every competitor cell is filled and the table is dated`, () => {
      const table = dict.partnersRecruiting.landing.benchmark!
      expect(table.verified.length).toBeGreaterThan(0)
      expect(table.footnote).toContain('Shopify')
    })
  }
})
