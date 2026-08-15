import { expect, test } from '@playwright/test'
import es from '../locales/es.json' with { type: 'json' }
import sellerPopulation from '../locales/seller-population.json' with { type: 'json' }
import { flattenDictionary } from '../lib/copy-tree'
import { buildPageNavGroups } from '../lib/copy-overrides-page-nav'
import { filterKeysBySection } from '../lib/copy-overrides-admin-view'
import { NO_SINGLE_PAGE_LABEL, routeForNamespaceSection } from '../lib/copy-overrides-routes'
import { sectionForKey, UNMAPPED_SELLER_SECTION, pageDirForSourceFile } from '../lib/copy-overrides-sections'

/**
 * The guard that makes `/admin/contenido`'s route map an ASSERTION rather than
 * a claim.
 *
 * Its header comment said "every `locales/es.json` top-level namespace is
 * covered" for months while `buyerShell`, `buyerCopy` and `sellerCopy` — 2587
 * of the dictionary's keys — were all missing, so the editor captioned most of
 * its own nav "sección no reconocida — revisar lib/copy-overrides-routes.ts".
 * A confident comment is not evidence. This spec runs the map over the LIVE
 * dictionary, so the next namespace added to `locales/*.json` without a route
 * entry reddens CI instead of shipping an editor that accuses itself.
 */

// The real thing, not a fixture — a fixture would have stayed green through the bug.
const liveKeys = flattenDictionary(es as Record<string, unknown>).map((e) => ({
  namespace: e.namespace,
  key: e.key,
}))

test.describe('route coverage over the live dictionary', () => {
  test('every namespace/section in locales/es.json resolves to a real destination', () => {
    const unresolved = [...new Set(
      liveKeys
        .filter((k) => routeForNamespaceSection(k.namespace, sectionForKey(k.namespace, k.key)) === null)
        .map((k) => `${k.namespace}.${sectionForKey(k.namespace, k.key)}`),
    )].sort()

    expect(unresolved).toEqual([])
  })

  test('no nav group is captioned with the unrecognized-section fallback', () => {
    const captions = buildPageNavGroups(liveKeys).flatMap((g) =>
      g.sections.map((s) => (s.route === null ? `${g.namespace}.${s.section}` : null)),
    )
    expect(captions.filter((c) => c !== null)).toEqual([])
    // The fallback string still exists — it is what a future unmapped section
    // would show — it just must not be reachable from the live dictionary.
    expect(NO_SINGLE_PAGE_LABEL).toContain('no reconocida')
  })

  test('the nav is small enough for a human: no namespace fans out past ~50 groups', () => {
    // The bug shipped 1809 nav entries for `sellerCopy` alone. This is not a
    // style preference — a nav that long is the failure mode itself, so the
    // ceiling is asserted rather than left to review.
    const groups = buildPageNavGroups(liveKeys)
    const oversized = groups.filter((g) => g.sections.length > 50).map((g) => `${g.namespace}=${g.sections.length}`)
    expect(oversized).toEqual([])
  })

  test('every nav group opens onto a NON-EMPTY field list (grouping and filtering agree)', () => {
    // The grouping rule and the filter rule were two separate inline copies of
    // `key.split('.')[0]`. If they ever disagree, a group renders in the nav and
    // then shows nothing when selected — silently, with no error anywhere.
    const empty: string[] = []
    for (const group of buildPageNavGroups(liveKeys)) {
      for (const section of group.sections) {
        const inGroup = filterKeysBySection(
          liveKeys.filter((k) => k.namespace === group.namespace),
          section.section,
        )
        if (inGroup.length !== section.count) {
          empty.push(`${group.namespace}.${section.section}: nav says ${section.count}, filter finds ${inGroup.length}`)
        }
      }
    }
    expect(empty).toEqual([])
  })
})

test.describe('sellerCopy sections come from the source file, not the hashed key', () => {
  test('locales/es.json and locales/seller-population.json cover exactly the same keys', () => {
    // `sectionForKey` reads the population file. If the two drift, sections go
    // wrong SILENTLY — this is the three-states check: known, unmapped, absent.
    const dictKeys = new Set(liveKeys.filter((k) => k.namespace === 'sellerCopy').map((k) => k.key))
    const populationKeys = new Set(sellerPopulation.files.flatMap((f) => f.keys))

    expect([...dictKeys].filter((k) => !populationKeys.has(k))).toEqual([])
    expect([...populationKeys].filter((k) => !dictKeys.has(k))).toEqual([])
  })

  test('no live sellerCopy key lands in the unmapped bucket', () => {
    const unmapped = liveKeys.filter(
      (k) => k.namespace === 'sellerCopy' && sectionForKey(k.namespace, k.key) === UNMAPPED_SELLER_SECTION,
    )
    expect(unmapped.map((k) => k.key)).toEqual([])
  })

  test('the unmapped bucket is still a REAL destination, not null (three states, never two)', () => {
    // "I could not map this" and "this namespace is unrecognized" are different
    // facts. Collapsing them would make drift look like a missing route entry.
    const route = routeForNamespaceSection('sellerCopy', UNMAPPED_SELLER_SECTION)
    expect(route).not.toBeNull()
    expect(route?.label).toContain('seller-population.json')
  })

  test('sellerCopy fans out into real seller-portal pages', () => {
    const group = buildPageNavGroups(liveKeys).find((g) => g.namespace === 'sellerCopy')!
    const sections = group.sections.map((s) => s.section)

    expect(sections).toContain('shop/manage/catalogo')
    expect(sections).toContain('sell')
    expect(sections).toContain('shop/manage/settings/pagos/wizard')
    // Route groups and private folders are NOT pages and must never become groups.
    expect(sections.some((s) => s.includes('(') || s.includes('_'))).toBe(false)
    expect(group.sections.every((s) => s.route?.path.startsWith('/'))).toBe(true)
  })
})

test.describe('pageDirForSourceFile', () => {
  test('drops the filename, app/, and route groups', () => {
    expect(pageDirForSourceFile('app/(shell)/shop/manage/orders/[id]/OrderDetail.tsx')).toBe('shop/manage/orders/[id]')
    expect(pageDirForSourceFile('app/(shell)/sell/(onboarding)/agente/page.tsx')).toBe('sell/agente')
    expect(pageDirForSourceFile('app/(shell)/sell/SellWizard.tsx')).toBe('sell')
  })

  test('a private co-location folder collapses into its parent page', () => {
    // `_sections/Pagos.tsx` renders inside `/shop/manage/settings` — it is not a
    // destination a merchant can navigate to, so it must not become one.
    expect(pageDirForSourceFile('app/(shell)/shop/manage/settings/_sections/Pagos.tsx')).toBe('shop/manage/settings')
    expect(pageDirForSourceFile('app/(shell)/shop/manage/_components/Foo.tsx')).toBe('shop/manage')
  })

  test('a segment that merely CONTAINS a paren or underscore is kept (the negation of what we ban)', () => {
    // A guard that rejects correct input is worse than one that misses a fault:
    // only a whole `(group)` segment and a leading-underscore folder are dropped.
    expect(pageDirForSourceFile('app/(shell)/shop/manage/mi_pagina/page.tsx')).toBe('shop/manage/mi_pagina')
  })
})
