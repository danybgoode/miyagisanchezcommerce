import { test, expect } from '@playwright/test'
import { buildCatalogQuery, buildCatalogPageUrl, CATALOG_PAGE_SIZE } from '../lib/catalog-query'

/**
 * Catalog table query builder — pure logic (api gate, no browser). Mirrors
 * `listing-query.spec`-style coverage for `lib/listing-query.ts`'s `buildQuery()`:
 * confirms the allow-list round-trips into a URL query string and that unrelated
 * params never leak through (catalog-management epic, Sprint 1 · Story 1.2).
 */

test.describe('catalog-query · buildCatalogQuery', () => {
  test('empty params produce an empty query string', () => {
    expect(buildCatalogQuery({})).toBe('')
  })

  test('round-trips every allowed filter key', () => {
    const qs = buildCatalogQuery({
      q: 'sticker',
      status: 'activo',
      category: 'papeleria',
      channel: 'ml',
      stock: 'in_stock',
      sort: 'title',
    })
    const params = new URLSearchParams(qs.slice(1))
    expect(params.get('q')).toBe('sticker')
    expect(params.get('status')).toBe('activo')
    expect(params.get('category')).toBe('papeleria')
    expect(params.get('channel')).toBe('ml')
    expect(params.get('stock')).toBe('in_stock')
    expect(params.get('sort')).toBe('title')
  })

  test('drops empty-string and undefined values', () => {
    expect(buildCatalogQuery({ q: '', status: undefined, category: 'autos' })).toBe('?category=autos')
  })

  test('never forwards `page` — that is a page-url concern, not the backend query', () => {
    const qs = buildCatalogQuery({ q: 'x', page: '3' })
    expect(new URLSearchParams(qs.slice(1)).has('page')).toBe(false)
  })

  test('adds limit/offset only when explicitly given', () => {
    expect(buildCatalogQuery({ q: 'x' }, { limit: 24, offset: 48 })).toBe('?q=x&limit=24&offset=48')
  })
})

test.describe('catalog-query · buildCatalogPageUrl', () => {
  test('page 1 omits the page param (canonical first-page URL)', () => {
    expect(buildCatalogPageUrl({ status: 'activo' }, 1)).toBe('/shop/manage/catalogo?status=activo')
  })

  test('page > 1 includes it', () => {
    expect(buildCatalogPageUrl({ status: 'activo' }, 2)).toBe('/shop/manage/catalogo?status=activo&page=2')
  })

  test('no filters at all → the bare catalog path', () => {
    expect(buildCatalogPageUrl({}, 1)).toBe('/shop/manage/catalogo')
  })

  test('CATALOG_PAGE_SIZE is a positive integer', () => {
    expect(CATALOG_PAGE_SIZE).toBeGreaterThan(0)
    expect(Number.isInteger(CATALOG_PAGE_SIZE)).toBe(true)
  })
})
