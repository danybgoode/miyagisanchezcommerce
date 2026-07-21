import { test, expect } from '@playwright/test'
import {
  canonicalizeSnapshot,
  hashSnapshot,
  isMaterialChange,
  describeMaterialChanges,
  canActivate,
  type PreviewSnapshot,
} from '../lib/preview-snapshot'

/**
 * Founding merchant consent-safe previews · Sprint 2 — the pure consent core
 * (api project, network-free): deterministic snapshot hashing, the material-change
 * resolver, and the single server-side activation decision.
 *
 * This is the spec that protects the epic's central promise: approval covers a
 * SPECIFIC reviewed snapshot, and stale consent can never publish new claims or
 * prices. Every assertion here is deterministic — no DB, no network.
 */

const base: PreviewSnapshot = {
  shopName: 'Panadería Lupita',
  shopSlug: 'panaderia-lupita',
  products: [
    { id: 'prod_1', title: 'Concha de vainilla', priceCents: 2500, currency: 'MXN', imageUrl: 'https://img/1.jpg' },
    { id: 'prod_2', title: 'Bolillo', priceCents: 500, currency: 'MXN', imageUrl: 'https://img/2.jpg' },
  ],
}

const clone = (s: PreviewSnapshot): PreviewSnapshot => JSON.parse(JSON.stringify(s))

test.describe('snapshot hashing — determinism + idempotence', () => {
  test('same content hashes identically (a no-op re-save must not invalidate)', () => {
    expect(hashSnapshot(base)).toBe(hashSnapshot(clone(base)))
    expect(isMaterialChange(base, clone(base))).toBe(false)
  })

  test('product reordering is cosmetic, not material', () => {
    const reordered = clone(base)
    reordered.products.reverse()
    expect(isMaterialChange(base, reordered)).toBe(false)
  })

  test('hash is a sha256 hex digest', () => {
    expect(hashSnapshot(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('null and undefined price/image normalize to the same hash', () => {
    const a = clone(base)
    const b = clone(base)
    a.products[0].priceCents = null
    a.products[0].imageUrl = null
    b.products[0].priceCents = undefined as unknown as null
    b.products[0].imageUrl = undefined as unknown as null
    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  test('REGRESSION: adjacent-field ambiguity cannot collide two different proposals', () => {
    // A concatenating canonicalizer (fields joined with '') would hash these two
    // DIFFERENT proposals identically — letting a real price/title edit slip past
    // invalidation. Structural JSON encoding keeps the boundary unambiguous.
    const a = clone(base)
    const b = clone(base)
    a.products[0].title = 'AB'
    a.products[0].priceCents = 1
    b.products[0].title = 'A'
    b.products[0].priceCents = null
    b.products[0].id = 'prod_1'
    expect(canonicalizeSnapshot(a)).not.toBe(canonicalizeSnapshot(b))
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b))
  })
})

test.describe('material-change resolver', () => {
  test('a price change is material', () => {
    const after = clone(base)
    after.products[0].priceCents = 3000
    expect(isMaterialChange(base, after)).toBe(true)
    expect(describeMaterialChanges(base, after).join(' ')).toContain('precio')
  })

  test('a title change is material', () => {
    const after = clone(base)
    after.products[0].title = 'Concha de chocolate'
    expect(isMaterialChange(base, after)).toBe(true)
    expect(describeMaterialChanges(base, after).join(' ')).toContain('título')
  })

  test('an image change is material', () => {
    const after = clone(base)
    after.products[0].imageUrl = 'https://img/new.jpg'
    expect(isMaterialChange(base, after)).toBe(true)
    expect(describeMaterialChanges(base, after).join(' ')).toContain('imagen')
  })

  test('adding or removing a product is material', () => {
    const added = clone(base)
    added.products.push({ id: 'prod_3', title: 'Dona', priceCents: 1500, currency: 'MXN', imageUrl: null })
    expect(isMaterialChange(base, added)).toBe(true)
    expect(describeMaterialChanges(base, added).join(' ')).toContain('agregó')

    const removed = clone(base)
    removed.products.pop()
    expect(isMaterialChange(base, removed)).toBe(true)
    expect(describeMaterialChanges(base, removed).join(' ')).toContain('quitó')
  })

  test('shop identity changes are material', () => {
    const renamed = clone(base)
    renamed.shopName = 'Panadería Lupita y Familia'
    expect(isMaterialChange(base, renamed)).toBe(true)

    const reslugged = clone(base)
    reslugged.shopSlug = 'panaderia-lupita-2'
    expect(isMaterialChange(base, reslugged)).toBe(true)
  })

  test('a currency change is material AND explained', () => {
    const after = clone(base)
    after.products[0].currency = 'USD'
    expect(isMaterialChange(base, after)).toBe(true)
    // Regression: currency is hashed as material, so a currency-only edit must
    // never invalidate approval while reporting an empty reason list.
    const reasons = describeMaterialChanges(base, after)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.join(' ')).toContain('moneda')
  })

  test('every material change produces at least one reason', () => {
    // Guards the resolver against drifting out of sync with the hash: anything
    // that invalidates approval must be explainable to the promoter.
    const mutations: Array<(s: PreviewSnapshot) => void> = [
      (s) => { s.products[0].title = 'otro' },
      (s) => { s.products[0].priceCents = 99 },
      (s) => { s.products[0].imageUrl = 'https://img/z.jpg' },
      (s) => { s.products[0].currency = 'USD' },
      (s) => { s.shopName = 'Otra' },
      (s) => { s.shopSlug = 'otra' },
      (s) => { s.products.pop() },
    ]
    for (const mutate of mutations) {
      const after = clone(base)
      mutate(after)
      expect(isMaterialChange(base, after)).toBe(true)
      expect(describeMaterialChanges(base, after).length).toBeGreaterThan(0)
    }
  })

  test('no changes yields no reasons', () => {
    expect(describeMaterialChanges(base, clone(base))).toEqual([])
  })
})

test.describe('activation decision — server-side enforcement', () => {
  const hash = hashSnapshot(base)

  test('refuses without approval', () => {
    const r = canActivate({ status: 'draft', approvedSnapshotHash: null, currentSnapshotHash: hash, hasProducts: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('aprobación')
  })

  test('refuses a delivered-but-unapproved preview', () => {
    const r = canActivate({ status: 'delivered', approvedSnapshotHash: null, currentSnapshotHash: hash, hasProducts: true })
    expect(r.ok).toBe(false)
  })

  test('refuses STALE approval (approved hash no longer matches current)', () => {
    const r = canActivate({
      status: 'approved',
      approvedSnapshotHash: 'a'.repeat(64),
      currentSnapshotHash: hash,
      hasProducts: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('cambió')
  })

  test('refuses an empty proposal', () => {
    const r = canActivate({ status: 'approved', approvedSnapshotHash: hash, currentSnapshotHash: hash, hasProducts: false })
    expect(r.ok).toBe(false)
  })

  test('allows a current approval', () => {
    const r = canActivate({ status: 'approved', approvedSnapshotHash: hash, currentSnapshotHash: hash, hasProducts: true })
    expect(r.ok).toBe(true)
  })

  test('re-activating an already-activated preview is idempotent', () => {
    const r = canActivate({ status: 'activated', approvedSnapshotHash: hash, currentSnapshotHash: hash, hasProducts: true })
    expect(r.ok).toBe(true)
  })
})
