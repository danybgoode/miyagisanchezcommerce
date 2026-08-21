import { expect, test } from '@playwright/test'
import { loadSeleccionCandidatePool } from '../lib/seleccion-candidates'
import type { Listing } from '../lib/types'

function listing(id: string): Listing {
  return { id } as Listing
}

test.describe('Selección admin · authoritative candidate pool', () => {
  test('an old pin outside the newest window remains visible and duplicates only once', async () => {
    const queries: string[] = []
    const fresh = [listing('new-1'), listing('already-pinned')]
    const pins = [listing('already-pinned'), listing('old-hidden-pin')]

    const pool = await loadSeleccionCandidatePool(async (query) => {
      queries.push(query)
      return query.includes('featured=true') ? pins : fresh
    }, 50)

    expect(queries).toEqual(['?sort=reciente&limit=50', '?featured=true&limit=100&page=1'])
    expect(pool.map((row) => row.id)).toEqual(['new-1', 'already-pinned', 'old-hidden-pin'])
  })

  test('either successful read still contributes when its sibling degrades to empty', async () => {
    const fresh = [listing('new-1')]
    const pinned = [listing('old-pin')]

    const withoutPins = await loadSeleccionCandidatePool(async (query) =>
      query.includes('featured=true') ? [] : fresh,
    )
    const withoutFresh = await loadSeleccionCandidatePool(async (query) =>
      query.includes('featured=true') ? pinned : [],
    )

    expect(withoutPins.map((row) => row.id)).toEqual(['new-1'])
    expect(withoutFresh.map((row) => row.id)).toEqual(['old-pin'])
  })

  test('featured pagination keeps pins beyond the backend single-page cap visible', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => listing(`pin-${index + 1}`))
    const queries: string[] = []

    const pool = await loadSeleccionCandidatePool(async (query) => {
      queries.push(query)
      if (!query.includes('featured=true')) return []
      return query.includes('page=1') ? firstPage : [listing('pin-101')]
    })

    expect(queries).toEqual([
      '?sort=reciente&limit=50',
      '?featured=true&limit=100&page=1',
      '?featured=true&limit=100&page=2',
    ])
    expect(pool).toHaveLength(101)
    expect(pool.at(-1)?.id).toBe('pin-101')
  })
})
