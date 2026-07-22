import { test, expect } from '@playwright/test'
import {
  buildChecklist,
  checklistComplete,
  nextAction,
  type ChecklistFacts,
} from '../lib/preview-checklist'
import {
  buildPreviewEventPayload,
  PREVIEW_LIFECYCLE_EVENTS,
  PREVIEW_FEATURE_ID,
} from '../lib/preview-events'

/**
 * Founding merchant consent-safe previews · Sprint 3 (api project, network-free):
 *
 *  1. THE READINESS CHECKLIST — the rule that BLOCKS a publication. Every required
 *     item must be provably blocking, and a complete checklist must actually pass.
 *  2. THE LIFECYCLE EVENT PAYLOAD — the contract that no merchant PII (email,
 *     WhatsApp, name, raw token) ever reaches golden-beans. Asserted against the
 *     real builder, not a re-declared shim.
 */

const ready: ChecklistFacts = {
  shopName: 'Panadería Lupita',
  hasLocation: true,
  hasMerchantContact: true,
  products: [
    { title: 'Concha de vainilla', priceCents: 2500, imageUrl: 'https://img/1.jpg' },
    { title: 'Bolillo', priceCents: 500, imageUrl: 'https://img/2.jpg' },
  ],
  status: 'approved',
  currentApproval: true,
  hasSteward: true,
}

const clone = (f: ChecklistFacts): ChecklistFacts => JSON.parse(JSON.stringify(f))

test.describe('readiness checklist — a complete one activates', () => {
  test('every required item is done when all facts are present', () => {
    const items = buildChecklist(ready)
    expect(checklistComplete(items)).toBe(true)
    expect(nextAction(items)).toBeNull()
    // The acceptance names the required coverage explicitly.
    const keys = items.filter((i) => i.required).map((i) => i.key)
    for (const required of [
      'merchant_identity', 'merchant_contact', 'product_facts', 'prices',
      'asset_provenance', 'merchant_review', 'current_approval', 'steward',
    ]) {
      expect(keys).toContain(required)
    }
  })

  test('the checklist is deterministic for identical facts', () => {
    expect(JSON.stringify(buildChecklist(ready))).toBe(JSON.stringify(buildChecklist(clone(ready))))
  })
})

test.describe('readiness checklist — each required item genuinely blocks', () => {
  const mutations: Array<{ key: string; label: string; mutate: (f: ChecklistFacts) => void }> = [
    { key: 'merchant_identity', label: 'no location', mutate: (f) => { f.hasLocation = false } },
    { key: 'merchant_identity', label: 'no shop name', mutate: (f) => { f.shopName = '' } },
    { key: 'merchant_contact', label: 'no merchant email', mutate: (f) => { f.hasMerchantContact = false } },
    { key: 'product_facts', label: 'a stub title', mutate: (f) => { f.products[0].title = 'x' } },
    { key: 'prices', label: 'a missing price', mutate: (f) => { f.products[1].priceCents = null } },
    { key: 'asset_provenance', label: 'a missing photo', mutate: (f) => { f.products[0].imageUrl = null } },
    { key: 'merchant_review', label: 'never opened', mutate: (f) => { f.status = 'draft' } },
    { key: 'current_approval', label: 'no current approval', mutate: (f) => { f.currentApproval = false } },
    { key: 'steward', label: 'no promoter', mutate: (f) => { f.hasSteward = false } },
  ]

  for (const { key, label, mutate } of mutations) {
    test(`"${key}" (${label}) blocks activation and names a next action`, () => {
      const facts = clone(ready)
      mutate(facts)
      const items = buildChecklist(facts)
      expect(checklistComplete(items)).toBe(false)
      expect(items.find((i) => i.key === key)?.done).toBe(false)
      // Every block must tell the promoter what to do — an unexplained refusal on
      // a consent surface is exactly the failure this epic exists to prevent.
      expect(nextAction(items)).toBeTruthy()
    })
  }

  test('an EMPTY proposal blocks on the product-shaped items', () => {
    const facts = clone(ready)
    facts.products = []
    const items = buildChecklist(facts)
    expect(checklistComplete(items)).toBe(false)
    for (const key of ['product_facts', 'prices', 'asset_provenance']) {
      expect(items.find((i) => i.key === key)?.done).toBe(false)
    }
  })

  test('a zero or negative price is not a price', () => {
    for (const priceCents of [0, -100]) {
      const facts = clone(ready)
      facts.products[0].priceCents = priceCents
      expect(checklistComplete(buildChecklist(facts))).toBe(false)
    }
  })

  test('any post-draft status satisfies merchant_review', () => {
    for (const status of ['delivered', 'changes_requested', 'approved', 'invalidated', 'activated']) {
      const facts = clone(ready)
      facts.status = status
      expect(buildChecklist(facts).find((i) => i.key === 'merchant_review')?.done).toBe(true)
    }
  })
})

test.describe('lifecycle events — PII-free by construction', () => {
  // The exact strings the acceptance forbids, planted in every field a caller
  // could plausibly pass, to prove they have nowhere to land in the payload.
  const PII = ['lupita@example.com', '+525512345678', 'Panadería Lupita', 'mp_deadbeef']

  test('every lifecycle event builds a payload with no merchant PII', () => {
    for (const event of PREVIEW_LIFECYCLE_EVENTS) {
      const payload = buildPreviewEventPayload(event, {
        shopId: 'a1b2c3d4-0000-0000-0000-000000000000',
        previewId: 'b2c3d4e5-0000-0000-0000-000000000000',
        version: 3,
        productCount: 2,
      })
      const serialized = JSON.stringify(payload)
      for (const secret of PII) {
        expect(serialized).not.toContain(secret)
      }
      expect(payload.event).toBe(event)
      expect(payload.featureId).toBe(PREVIEW_FEATURE_ID)
      // The subject is the non-personal mirror id, never a name or contact.
      expect(payload.userId).toBe('a1b2c3d4-0000-0000-0000-000000000000')
    }
  })

  test('the payload is an ALLOW-LIST — extra caller fields cannot leak through', () => {
    const payload = buildPreviewEventPayload('preview_approved', {
      shopId: 'shop-1',
      previewId: 'preview-1',
      // Deliberately smuggling PII in via extra keys a future caller might add.
      ...({ merchantEmail: 'lupita@example.com', shopName: 'Panadería Lupita', token: 'mp_deadbeef' } as object),
    })
    const serialized = JSON.stringify(payload)
    for (const secret of PII) {
      expect(serialized).not.toContain(secret)
    }
    expect(Object.keys(payload).sort()).toEqual(['event', 'featureId', 'tags', 'userId'])
    expect(Object.keys(payload.tags).sort()).toEqual(['preview_id', 'shop_id'])
  })

  test('optional facts are omitted rather than emitted as null', () => {
    const payload = buildPreviewEventPayload('shop_claimed', { shopId: 'shop-1' })
    expect(payload.tags).toEqual({ shop_id: 'shop-1' })
  })
})
