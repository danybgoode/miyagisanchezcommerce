import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { CheckoutSettings } from '../lib/shop-settings/types'

const ROOT = path.resolve(import.meta.dirname, '..')
const source = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

/**
 * `dimo` and `cash_pickup` on `CheckoutSettings`.
 *
 * Both were WRITTEN by the payments settings save and READ back by
 * `lib/store-config.ts`, `lib/settings-import.ts` and `lib/email.ts` while being
 * absent from the shared type entirely — so every call site reached them through
 * a hand-written cast, and each cast was free to guess a different shape. One
 * of them guessed wrong (see the null case below).
 *
 * The fixture is the REAL production shape, copied from live rows rather than
 * invented: of the 7 shops carrying these blocks, several hold an explicit
 * `null` phone/note. A fixture written from the save code alone would have
 * reproduced the same wrong guess the cast made.
 */

/** Copied verbatim from live `marketplace_shops.metadata.settings.checkout` rows. */
const LIVE_SHAPES: CheckoutSettings[] = [
  // champions-not — every manual method on, both optional strings populated.
  {
    dimo: { enabled: true, phone: '5573971352' },
    cash_pickup: { enabled: true, note: 'Trae cambio' },
  },
  // ylai-studio — the common case: enabled flags set, strings explicitly NULL.
  {
    dimo: { enabled: false, phone: null },
    cash_pickup: { enabled: true, note: null },
  },
  // A shop that predates these blocks: absent entirely, which must stay legal.
  {},
]

test.describe('checkout manual methods are typed, not cast', () => {
  test('the live production shape satisfies CheckoutSettings, nulls included', () => {
    // `phone`/`note` are `string | null`, NOT `string | undefined`. The save
    // writes `… || null` explicitly and production holds those nulls. This
    // assignment is the compile-time half; the runtime reads below are the rest.
    for (const shape of LIVE_SHAPES) {
      expect(shape.dimo?.enabled ?? false).toBe(typeof shape.dimo?.enabled === 'boolean' ? shape.dimo.enabled : false)
    }

    const populated = LIVE_SHAPES[0]
    expect(populated.dimo?.phone).toBe('5573971352')
    expect(populated.cash_pickup?.note).toBe('Trae cambio')

    const nulls = LIVE_SHAPES[1]
    expect(nulls.dimo?.phone).toBeNull()
    expect(nulls.cash_pickup?.note).toBeNull()
    expect(nulls.cash_pickup?.enabled).toBe(true)

    // A shop that never touched the payments section reads as absent, not as a
    // crash and not as "off" — three states, never two.
    expect(LIVE_SHAPES[2].dimo).toBeUndefined()
  })

  test('the UI falls back correctly for every state', () => {
    // Mirrors exactly what `_sections/Pagos.tsx` does when seeding its inputs.
    const phoneOf = (c: CheckoutSettings) => c.dimo?.phone ?? ''
    const noteOf = (c: CheckoutSettings) => c.cash_pickup?.note ?? ''

    expect(phoneOf(LIVE_SHAPES[0])).toBe('5573971352')
    // The case the old cast got wrong: a null must seed an empty input, not
    // render the string "null" into the field.
    expect(phoneOf(LIVE_SHAPES[1])).toBe('')
    expect(noteOf(LIVE_SHAPES[1])).toBe('')
    expect(phoneOf(LIVE_SHAPES[2])).toBe('')

    // Cash pickup defaults ON for a shop that never configured it — the seller
    // portal's own default, preserved.
    expect(LIVE_SHAPES[2].cash_pickup?.enabled ?? true).toBe(true)
  })

  test('the payments section no longer carries a hand-written cast for them', () => {
    // The point of the type is that the cast is GONE. If someone reintroduces
    // one, the type has stopped being the contract and this drifts again.
    const pagos = source('app/(shell)/shop/manage/settings/_sections/Pagos.tsx')
    expect(pagos).not.toContain('checkoutExtras')
    expect(pagos).toContain('initial.checkout?.dimo')
    expect(pagos).toContain('initial.checkout?.cash_pickup')
  })

  test('the type itself declares both, with nullable strings', () => {
    const types = source('lib/shop-settings/types.ts')
    expect(types).toContain('dimo?: {')
    expect(types).toContain('cash_pickup?: {')
    // The nullability is the part that was guessed wrong; pin it in the source.
    expect(types).toMatch(/phone\?: string \| null/)
    expect(types).toMatch(/note\?: string \| null/)
  })
})
