import { expect, test } from '@playwright/test'
import {
  planWave01Retirement,
  selectRetirementTargets,
  WAVE01_NAMES,
} from '../scripts/lib/wave01-promoter-retirement.mjs'

test.describe('planWave01Retirement — resume cross-store partial writes safely', () => {
  const publicSlug = 'concrete-garden-candles'
  const retiredSlug = 'concrete-garden-preview-retired-20260820'

  test('starts all three writes for an untouched seller', () => {
    expect(planWave01Retirement({ mirrorSlug: publicSlug, retiredSlug, sellerStatus: 'active' })).toEqual({
      ensureSellerSlug: true,
      retireSeller: true,
      updateMirrorSlug: true,
    })
  })

  test('retries the Medusa slug proof and mirror after a delete-before-mirror partial failure', () => {
    expect(planWave01Retirement({ mirrorSlug: publicSlug, retiredSlug, sellerStatus: 'deleted' })).toEqual({
      ensureSellerSlug: true,
      retireSeller: false,
      updateMirrorSlug: true,
    })
  })

  test('finishes a status write after a slug-before-status partial failure', () => {
    expect(planWave01Retirement({ mirrorSlug: retiredSlug, retiredSlug, sellerStatus: 'active' })).toEqual({
      ensureSellerSlug: false,
      retireSeller: true,
      updateMirrorSlug: false,
    })
  })

  test('makes a completed correction a no-op', () => {
    expect(planWave01Retirement({ mirrorSlug: retiredSlug, retiredSlug, sellerStatus: 'deleted' })).toEqual({
      ensureSellerSlug: false,
      retireSeller: false,
      updateMirrorSlug: false,
    })
  })
})

test.describe('selectRetirementTargets — exact, unclaimed promoter previews only', () => {
  const rows = WAVE01_NAMES.map((name, index) => ({
    id: `mirror-${index}`,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    source_url: `promoter://${index}`,
    clerk_user_id: null,
    metadata: { medusa_seller_id: `sel_${index}` },
  }))

  test('accepts exactly the four expected previews and respects the backend slug ceiling', () => {
    const targets = selectRetirementTargets(rows)
    expect(targets).toHaveLength(4)
    expect(targets.every((target) => target.retiredSlug.length <= 40)).toBe(true)
  })

  test('refuses a claimed or ambiguous name match before any mutation', () => {
    expect(() => selectRetirementTargets([
      ...rows.slice(0, 3),
      { ...rows[3], clerk_user_id: 'user_claimed' },
    ])).toThrow(/Concrete Garden Candles: REFUSE claimed shop/)
    expect(() => selectRetirementTargets([...rows, { ...rows[0], id: 'duplicate' }])).toThrow(/Kokone: expected exactly one mirror row, found 2/)
  })
})
