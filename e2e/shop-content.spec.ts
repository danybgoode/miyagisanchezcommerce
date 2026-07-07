import { test, expect } from '@playwright/test'
import { wellFormedFaqItems, authoredAboutBody } from '../lib/shop-content'

/**
 * Own-shop premium presentation (epic 07, Sprint 3) — the shared "is this
 * content page authored?" helpers used by the public pages, the shop-home nav
 * links, and the sitemap. Added after cross-agent review flagged that the
 * public FAQ page/nav/sitemap only checked `items.length`, so a malformed row
 * (empty question or answer — reachable via a raw PATCH /api/sell/shop call,
 * which does not validate `about`/`faq` the way the editor and
 * Storefront-as-Code's `validateConfig()` do) could produce an "authored"
 * page with blank public content.
 */
test.describe('wellFormedFaqItems', () => {
  test('keeps only rows with a non-empty question and answer', () => {
    const items = wellFormedFaqItems([
      { question: '¿Envíos?', answer: '3-5 días.' },
      { question: '', answer: 'Sin pregunta' },
      { question: 'Sin respuesta', answer: '' },
      { question: '   ', answer: '   ' },
    ])
    expect(items).toEqual([{ question: '¿Envíos?', answer: '3-5 días.' }])
  })

  test('trims whitespace on the surviving rows', () => {
    const items = wellFormedFaqItems([{ question: '  ¿Hola?  ', answer: '  Sí  ' }])
    expect(items).toEqual([{ question: '¿Hola?', answer: 'Sí' }])
  })

  test('tolerates undefined/null input (no throw, empty array)', () => {
    expect(wellFormedFaqItems(undefined)).toEqual([])
    expect(wellFormedFaqItems(null)).toEqual([])
    expect(wellFormedFaqItems([])).toEqual([])
  })
})

test.describe('authoredAboutBody', () => {
  test('returns the trimmed body when present', () => {
    expect(authoredAboutBody({ body: '  Hola mundo  ' })).toBe('Hola mundo')
  })

  test('returns null for empty/whitespace-only/absent body', () => {
    expect(authoredAboutBody({ body: '   ' })).toBeNull()
    expect(authoredAboutBody({})).toBeNull()
    expect(authoredAboutBody(null)).toBeNull()
    expect(authoredAboutBody(undefined)).toBeNull()
  })
})
