import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SECTION_TITLE_RULES,
  findStaleTitle,
} from '../lib/seller-section-titles'

/**
 * seller-nav-consolidation S1.3 — lock the canonical section titles (api gate, no
 * browser). The section page titles already read Cupones / Analíticas /
 * Configuración / Importar catálogo; this guard keeps them from drifting back to
 * the old nav labels. Pure offender-finder against the real tree plus in-memory
 * negative fixtures, same shape as the raw-color / monolith guards.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Concatenated source of every .tsx/.ts file directly under a section dir. */
async function readSectionSource(dir: string): Promise<string> {
  const abs = join(repoRoot, dir)
  const entries = await readdir(abs, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
  const sources = await Promise.all(files.map((e) => readFile(join(abs, e.name), 'utf8')))
  return sources.join('\n')
}

test.describe('seller-section-titles · guard', () => {
  for (const rule of SECTION_TITLE_RULES) {
    test(`${rule.key}: canonical "${rule.canonical}" present, no old title`, async () => {
      const source = await readSectionSource(rule.dir)
      // sanity: we actually read the right tree
      expect(source).toContain(rule.canonical)
      expect(findStaleTitle(source, rule.forbidden)).toEqual([])
    })
  }

  test('negative fixture: a reverted old title goes red', () => {
    const promo = SECTION_TITLE_RULES.find((r) => r.key === 'promociones')!
    expect(findStaleTitle('export const metadata = { title: "Promociones" }', promo.forbidden))
      .toEqual(['Promociones'])

    const ana = SECTION_TITLE_RULES.find((r) => r.key === 'analitica')!
    // catches the old singular, allows the canonical plural
    expect(findStaleTitle('<h1>Analítica de la tienda</h1>', ana.forbidden)).toEqual(['Analítica'])
    expect(findStaleTitle('<h1>Analíticas de suscripciones</h1>', ana.forbidden)).toEqual([])

    const imp = SECTION_TITLE_RULES.find((r) => r.key === 'importar')!
    // catches a bare "Importar" title, allows "Importar catálogo"
    expect(findStaleTitle('<h1>Importar</h1>', imp.forbidden)).toEqual(['Importar'])
    expect(findStaleTitle('<h1>Importar catálogo</h1>', imp.forbidden)).toEqual([])
  })
})
