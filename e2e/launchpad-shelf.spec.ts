import { test, expect } from '@playwright/test'
import {
  deriveShelfSuggestion,
  findConvocatoria,
  CONVOCATORIA_COLLECTION_NAME,
  type ShelfWork,
  type ShelfCollection,
} from '../lib/launchpad-shelf'

/**
 * Bookshop launchpad — Sprint 2, Story 2.2 ("El estante Convocatoria").
 *
 * Pure-logic gate for the shelf-suggestion deriver: suggest only when there are
 * published works AND at least one isn't shelved; match the Convocatoria
 * collection case-insensitively; never drop existing memberships (the endpoint
 * unions around this). No network / no `next/*` — runs in the `api` gate.
 */

const conv: ShelfCollection = { id: 'cat_conv', name: CONVOCATORIA_COLLECTION_NAME, handle: 'mishop-convocatoria' }
const other: ShelfCollection = { id: 'cat_other', name: 'Zines', handle: 'mishop-zines' }

function work(id: string, collectionIds: string[] = []): ShelfWork {
  return { productId: id, collectionIds }
}

test.describe('launchpad-shelf · findConvocatoria', () => {
  test('matches the name case-insensitively', () => {
    expect(findConvocatoria([{ id: 'x', name: 'convocatoria', handle: 'mishop-convocatoria' }])?.id).toBe('x')
    expect(findConvocatoria([other])).toBeNull()
    expect(findConvocatoria([])).toBeNull()
  })
})

test.describe('launchpad-shelf · deriveShelfSuggestion', () => {
  test('no works → no suggestion', () => {
    const s = deriveShelfSuggestion([], [conv])
    expect(s.suggest).toBe(false)
    expect(s.missingWorkIds).toEqual([])
    expect(s.totalWorks).toBe(0)
  })

  test('works but no Convocatoria collection yet → suggest all as missing', () => {
    const s = deriveShelfSuggestion([work('p1'), work('p2', ['cat_other'])], [other])
    expect(s.suggest).toBe(true)
    expect(s.convocatoria).toBeNull()
    expect(s.missingWorkIds).toEqual(['p1', 'p2'])
    expect(s.totalWorks).toBe(2)
  })

  test('Convocatoria exists but some works not in it → suggest only the missing', () => {
    const s = deriveShelfSuggestion(
      [work('p1', ['cat_conv']), work('p2', ['cat_other']), work('p3')],
      [conv, other],
    )
    expect(s.suggest).toBe(true)
    expect(s.convocatoria?.id).toBe('cat_conv')
    expect(s.missingWorkIds).toEqual(['p2', 'p3'])
  })

  test('all works already shelved → no suggestion (card disappears)', () => {
    const s = deriveShelfSuggestion(
      [work('p1', ['cat_conv']), work('p2', ['cat_conv', 'cat_other'])],
      [conv, other],
    )
    expect(s.suggest).toBe(false)
    expect(s.missingWorkIds).toEqual([])
    expect(s.convocatoria?.id).toBe('cat_conv')
  })
})
