import { expect, test } from '@playwright/test'
import { buildBatchApplyRows, draftPathOf, removeAppliedDrafts, type DraftEntry } from '../lib/copy-overrides-draft-batch'

// Pure-seam coverage for the batched-save aggregation (epic 08 ·
// cms-contenido-restore-and-polish, Story 3.2) — turns the editor's dirty-
// draft map into the EXISTING bulk-apply route's `rows` shape; no new route.

test.describe('draftPathOf', () => {
  test('joins namespace and key with a dot — namespaces never contain dots', () => {
    expect(draftPathOf('sellerAcquisition', 'autos.heroTitle')).toBe('sellerAcquisition.autos.heroTitle')
  })
})

test.describe('buildBatchApplyRows', () => {
  test('emits one row per SET locale field, across multiple drafts', () => {
    const drafts: Record<string, DraftEntry> = {
      'home.ribbon.body': { namespace: 'home', key: 'ribbon.body', es: 'Nuevo texto' },
      'terms.title': { namespace: 'terms', key: 'title', es: 'Términos v2', en: 'Terms v2' },
    }
    const rows = buildBatchApplyRows(drafts)
    expect(rows).toEqual([
      { namespace: 'home', key: 'ribbon.body', locale: 'es', value: 'Nuevo texto' },
      { namespace: 'terms', key: 'title', locale: 'es', value: 'Términos v2' },
      { namespace: 'terms', key: 'title', locale: 'en', value: 'Terms v2' },
    ])
  })

  test('an empty drafts map produces an empty rows array', () => {
    expect(buildBatchApplyRows({})).toEqual([])
  })

  test('a draft with neither locale set (should not normally occur) emits nothing for it', () => {
    const drafts: Record<string, DraftEntry> = { 'home.x': { namespace: 'home', key: 'x' } }
    expect(buildBatchApplyRows(drafts)).toEqual([])
  })
})

test.describe('removeAppliedDrafts', () => {
  test('a fully-successful save (empty rejected) clears every draft', () => {
    const drafts: Record<string, DraftEntry> = {
      'home.ribbon.body': { namespace: 'home', key: 'ribbon.body', es: 'x' },
      'terms.title': { namespace: 'terms', key: 'title', es: 'y' },
    }
    expect(removeAppliedDrafts(drafts, [])).toEqual({})
  })

  test('a partial failure keeps ONLY the rejected drafts pending', () => {
    const drafts: Record<string, DraftEntry> = {
      'home.ribbon.body': { namespace: 'home', key: 'ribbon.body', es: 'x' },
      'terms.title': { namespace: 'terms', key: 'title', es: 'y' },
    }
    const next = removeAppliedDrafts(drafts, [{ namespace: 'terms', key: 'title', error: 'unknown key' }])
    expect(next).toEqual({ 'terms.title': { namespace: 'terms', key: 'title', es: 'y' } })
  })

  test('a malformed rejected entry (non-string namespace/key) is ignored, never throws', () => {
    const drafts: Record<string, DraftEntry> = { 'home.x': { namespace: 'home', key: 'x', es: 'a' } }
    expect(removeAppliedDrafts(drafts, [{ namespace: undefined, key: 123 }])).toEqual({})
  })
})
