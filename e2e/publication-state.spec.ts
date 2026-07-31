import { test, expect } from '@playwright/test'
import {
  derivePublicationState,
  nextPublicationRequest,
  createPublishToMarket,
  publicationChangeToastMessage,
  PUBLICATION_STATE_LABEL,
  PUBLICATION_STATE_HINT,
  type PublicationState,
} from '../lib/publication-state'
import { publicationStateToToken } from '../lib/status-badge'

/**
 * owned-shop-operating-channel epic, Sprint 3 · Story 3.3 (frontend) — pure
 * logic only (api gate, no browser, no network). Mirrors the backend's own
 * exhaustive-over-the-input-domain style (product-publication.unit.spec.ts):
 * every one of the 4 boolean combinations for the two independent membership
 * facts is asserted by name, not by example.
 */

const ALL_STATES: PublicationState[] = ['published', 'operating_only', 'unsellable']

test.describe('derivePublicationState · exhaustive over the 2×2 input domain', () => {
  test('both memberships true → published', () => {
    expect(derivePublicationState({ in_operating_channel: true, in_marketplace_channel: true })).toBe('published')
  })

  test('operating only (D2\'s normal shape: buyable, not listed) → operating_only', () => {
    expect(derivePublicationState({ in_operating_channel: true, in_marketplace_channel: false })).toBe('operating_only')
  })

  test('neither → unsellable, and NEVER read as an error state or as draft', () => {
    expect(derivePublicationState({ in_operating_channel: false, in_marketplace_channel: false })).toBe('unsellable')
  })

  test('marketplace true but operating false — structurally impossible per D2, but if the read degrades, marketplace still wins (published)', () => {
    // D2 makes marketplace membership a strict SUBSET of operating membership, so
    // this combination should never occur live. The deriver still has an answer
    // for it (marketplace checked first, unconditionally) rather than throwing —
    // a defensive read must not crash the whole catalog table over one bad row.
    expect(derivePublicationState({ in_operating_channel: false, in_marketplace_channel: true })).toBe('published')
  })
})

test.describe('publication state labels/hints — every state has both, es-MX, pairwise distinct', () => {
  for (const state of ALL_STATES) {
    test(`${state} has a non-empty label and hint`, () => {
      expect(PUBLICATION_STATE_LABEL[state].length).toBeGreaterThan(0)
      expect(PUBLICATION_STATE_HINT[state].length).toBeGreaterThan(0)
    })
  }

  test('labels are pairwise distinct — no two states read the same to a seller', () => {
    expect(new Set(ALL_STATES.map((s) => PUBLICATION_STATE_LABEL[s])).size).toBe(ALL_STATES.length)
  })

  test('"operating_only" never says "draft" or "error" — the exact confusion this story removes', () => {
    const text = `${PUBLICATION_STATE_LABEL.operating_only} ${PUBLICATION_STATE_HINT.operating_only}`.toLowerCase()
    expect(text).not.toContain('borrador')
    expect(text).not.toContain('error')
  })
})

test.describe('publicationStateToToken — one of the 5 semantic tokens, never a raw color', () => {
  test('published is success, operating_only is info (not danger — it is not an error state)', () => {
    expect(publicationStateToToken('published')).toBe('success')
    expect(publicationStateToToken('operating_only')).toBe('info')
  })

  test('unsellable is danger — the one state that should not occur must still read as a warning', () => {
    expect(publicationStateToToken('unsellable')).toBe('danger')
  })

  test('an unrecognised value degrades to neutral, never throws', () => {
    expect(publicationStateToToken('made_up_state')).toBe('neutral')
  })
})

test.describe('nextPublicationRequest · what a click on the toggle sends', () => {
  test('published → null (unpublish)', () => {
    expect(nextPublicationRequest('published')).toBe(null)
  })

  test('operating_only → "mx" (publish)', () => {
    expect(nextPublicationRequest('operating_only')).toBe('mx')
  })

  test('unsellable → undefined — no action is offered for a state that should not occur', () => {
    expect(nextPublicationRequest('unsellable')).toBeUndefined()
  })
})

test.describe('createPublishToMarket · the create-payload field, exhaustive over the boolean domain', () => {
  test('false (flag off, or the box unchecked) → undefined — omitted, byte-identical to pre-epic behaviour', () => {
    expect(createPublishToMarket(false)).toBeUndefined()
  })

  test('true ("solo mi tienda" checked, flag on) → null', () => {
    expect(createPublishToMarket(true)).toBe(null)
  })
})

test.describe('publicationChangeToastMessage · 423 reads as a different fact from 422/503', () => {
  test('the backend\'s own message always wins when present', () => {
    expect(publicationChangeToastMessage(422, 'Tu tienda opera en MX…')).toBe('Tu tienda opera en MX…')
    expect(publicationChangeToastMessage(423, 'mensaje del backend')).toBe('mensaje del backend')
    expect(publicationChangeToastMessage(503, 'mensaje del backend')).toBe('mensaje del backend')
  })

  test('423 fallback never blames the seller — it names the capability, not a mistake', () => {
    const msg = publicationChangeToastMessage(423, undefined)
    expect(msg).toContain('no está disponible')
    expect(msg).not.toMatch(/no puedes|no se puede|inválid/i)
  })

  test('503 fallback reads as an outage, not a refusal', () => {
    const msg = publicationChangeToastMessage(503, undefined)
    expect(msg.toLowerCase()).toContain('no está disponible')
  })

  test('the three fallback messages (422-ish default, 423, 503) are pairwise distinct', () => {
    const messages = [
      publicationChangeToastMessage(422, undefined),
      publicationChangeToastMessage(423, undefined),
      publicationChangeToastMessage(503, undefined),
    ]
    expect(new Set(messages).size).toBe(3)
  })

  test('an unrecognised status falls back to the generic message, never throws', () => {
    expect(publicationChangeToastMessage(500, undefined).length).toBeGreaterThan(0)
  })
})
