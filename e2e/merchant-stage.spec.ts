import { test, expect } from '@playwright/test'
import {
  STAGES,
  STAGE_ORDINAL,
  isStage,
  resolveStage,
  advanceDedupeKey,
  correctionDedupeKey,
  isCorrectionDedupeKey,
  type Stage,
  type StageFacts,
} from '../lib/merchant-stage'

/**
 * Founding merchant activation operations · Sprint 2, Story 2.1 (api project,
 * network-free): the pure 13-stage resolver every acceptance in sprint-2.md
 * §2.1 describes — "one explainable 13-stage journey", "replay produces no
 * second transition" (the dedupe-key helpers), and "permission stages require
 * consent evidence" (asserted directly, per the build contract's explicit
 * instruction).
 *
 * `lib/merchant-stage.ts` is zero-import, so every branch below is walked
 * with no database, no Clerk, no Next — exactly the convention
 * `lib/merchant-identity.ts` and `lib/merchant-lifecycle.ts` already use.
 */

// A facts object with EVERY predicate satisfied — the "reached the end"
// fixture, built once and copied so a per-test mutation never leaks.
const ALL_TRUE: Required<StageFacts> = {
  qualified: true,
  permissionGrantedEvidence: true,
  previewInPreparation: true,
  previewDeliveredEvidence: true,
  activationScheduled: true,
  claimed: true,
  paymentsReady: true,
  threeProductsLive: true,
  sharedExternally: true,
  firstInquiry: true,
  firstSale: true,
  retained30d: true,
}

function factsUpTo(stage: Stage): StageFacts {
  const order: Array<[Stage, keyof StageFacts]> = [
    ['qualified', 'qualified'],
    ['permission_granted', 'permissionGrantedEvidence'],
    ['preview_in_preparation', 'previewInPreparation'],
    ['preview_delivered', 'previewDeliveredEvidence'],
    ['activation_scheduled', 'activationScheduled'],
    ['claimed', 'claimed'],
    ['payments_ready', 'paymentsReady'],
    ['three_products_live', 'threeProductsLive'],
    ['shared_externally', 'sharedExternally'],
    ['first_inquiry', 'firstInquiry'],
    ['first_sale', 'firstSale'],
    ['retained_30d', 'retained30d'],
  ]
  const facts: StageFacts = {}
  for (const [s, key] of order) {
    facts[key] = true
    if (s === stage) break
  }
  return facts
}

test.describe('the 13 stages — ordered, frozen ordinals', () => {
  test('exactly 13 stages, in the canonical order the build contract lists', () => {
    expect(STAGES).toEqual([
      'scouted',
      'qualified',
      'permission_granted',
      'preview_in_preparation',
      'preview_delivered',
      'activation_scheduled',
      'claimed',
      'payments_ready',
      'three_products_live',
      'shared_externally',
      'first_inquiry',
      'first_sale',
      'retained_30d',
    ])
    expect(STAGES.length).toBe(13)
  })

  test('ordinals are 1–13, frozen to array position', () => {
    STAGES.forEach((stage, i) => {
      expect(STAGE_ORDINAL[stage]).toBe(i + 1)
    })
    expect(STAGE_ORDINAL.scouted).toBe(1)
    expect(STAGE_ORDINAL.retained_30d).toBe(13)
  })

  test('isStage: every canonical slug is recognized; garbage, empty and non-string values are not', () => {
    for (const s of STAGES) expect(isStage(s)).toBe(true)
    expect(isStage('permission_received')).toBe(false) // the prose typo — never a valid slug here
    expect(isStage('')).toBe(false)
    expect(isStage(null)).toBe(false)
    expect(isStage(undefined)).toBe(false)
    expect(isStage(42)).toBe(false)
  })
})

test.describe('resolveStage — no facts at all → scouted, never anything else', () => {
  test('empty object', () => {
    expect(resolveStage({})).toEqual({ stage: 'scouted', reached: ['scouted'] })
  })

  test('every field explicitly false', () => {
    const facts: StageFacts = Object.fromEntries(Object.keys(ALL_TRUE).map((k) => [k, false]))
    expect(resolveStage(facts).stage).toBe('scouted')
  })

  test('null/undefined facts bag is treated as empty, not thrown', () => {
    // @ts-expect-error — deliberately calling with a non-conforming value to
    // prove the runtime guard, not just the type.
    expect(resolveStage(null).stage).toBe('scouted')
    // @ts-expect-error — same, for undefined.
    expect(resolveStage(undefined).stage).toBe('scouted')
  })
})

test.describe('resolveStage — the full monotonic table, every stage in order', () => {
  for (const stage of STAGES.slice(1)) {
    test(`facts true through exactly "${stage}" → resolves to "${stage}", reached is the exact prefix`, () => {
      const result = resolveStage(factsUpTo(stage))
      expect(result.stage).toBe(stage)
      const idx = STAGES.indexOf(stage)
      expect(result.reached).toEqual(STAGES.slice(0, idx + 1))
    })
  }

  test('every fact true → retained_30d, reached is all 13 stages', () => {
    const result = resolveStage(ALL_TRUE)
    expect(result.stage).toBe('retained_30d')
    expect(result.reached).toEqual(STAGES)
  })
})

test.describe('resolveStage — fails CLOSED: unknown/absent facts decline, never grant', () => {
  test('a later-stage fact true while an EARLIER one is absent never skips ahead (no jump)', () => {
    const facts: StageFacts = { qualified: true, threeProductsLive: true, firstSale: true, retained30d: true }
    // permission_granted's own fact was never set → the walk stops right after "qualified".
    expect(resolveStage(facts).stage).toBe('qualified')
  })

  test('a gap ANYWHERE in the middle stops the walk there, regardless of what holds after it', () => {
    const facts = factsUpTo('claimed')
    // Knock out an early-chain fact retroactively (simulating a caller bug) —
    // the walk must stop at the FIRST failing predicate, not just "the last one".
    delete (facts as Record<string, unknown>).previewInPreparation
    expect(resolveStage(facts).stage).toBe('permission_granted')
  })

  test('a non-boolean truthy value (string "true", 1) never satisfies a predicate — only literal `true`', () => {
    const facts = { qualified: 'true' as unknown as boolean } as StageFacts
    expect(resolveStage(facts).stage).toBe('scouted')
    const facts2 = { qualified: 1 as unknown as boolean } as StageFacts
    expect(resolveStage(facts2).stage).toBe('scouted')
  })
})

test.describe('resolveStage — permission-gated stages require dedicated evidence, never a note (build contract, asserted directly)', () => {
  test('permission_granted: every OTHER fact true, evidence fact absent → still refused at qualified', () => {
    const facts: StageFacts = { ...ALL_TRUE, permissionGrantedEvidence: false }
    expect(resolveStage(facts).stage).toBe('qualified')
  })

  test('preview_delivered: qualified + permission granted + preview-in-prep all true, but its OWN evidence fact is false → stops at preview_in_preparation', () => {
    const facts: StageFacts = {
      qualified: true,
      permissionGrantedEvidence: true,
      previewInPreparation: true,
      previewDeliveredEvidence: false,
    }
    expect(resolveStage(facts).stage).toBe('preview_in_preparation')
  })

  test("a 'note-shaped' extra field can never influence the result — StageFacts has no field a free-text note could populate", () => {
    // Simulates a promoter's note/objection somehow being smuggled onto the
    // facts bag under a plausible-looking key. TypeScript already prevents
    // this at compile time (the cast is required); this proves it ALSO can't
    // matter at runtime — the resolver only ever reads the exact predicate
    // fields it declares.
    const facts = {
      fitNote: 'el dueño dijo que sí de palabra',
      objections: 'ninguna',
      hasPermissionNote: true,
      permissionGrantedEvidence: undefined,
    } as unknown as StageFacts
    expect(resolveStage(facts).stage).toBe('scouted')
  })

  test('both gated stages satisfied with their OWN dedicated evidence facts → both reached, in order', () => {
    const facts: StageFacts = {
      qualified: true,
      permissionGrantedEvidence: true,
      previewInPreparation: true,
      previewDeliveredEvidence: true,
    }
    const result = resolveStage(facts)
    expect(result.stage).toBe('preview_delivered')
    expect(result.reached).toContain('permission_granted')
    expect(result.reached).toContain('preview_delivered')
  })
})

test.describe('resolveStage — no regression path exists in the pure function itself', () => {
  test('reached always includes every stage up to and including the resolved stage — never a hole', () => {
    for (const stage of STAGES.slice(1)) {
      const idx = STAGES.indexOf(stage)
      const result = resolveStage(factsUpTo(stage))
      expect(result.reached.length).toBe(idx + 1)
      expect(new Set(result.reached).size).toBe(result.reached.length) // no duplicates
    }
  })

  test('the resolver is a PURE function of its input — same facts in, byte-identical result out, called twice', () => {
    const facts = factsUpTo('payments_ready')
    expect(JSON.stringify(resolveStage(facts))).toBe(JSON.stringify(resolveStage(facts)))
  })
})

test.describe('dedupe keys — the replay-produces-no-second-transition contract', () => {
  test('advanceDedupeKey is exactly the stage slug (the UNIQUE constraint natural key)', () => {
    for (const stage of STAGES) expect(advanceDedupeKey(stage)).toBe(stage)
  })

  test('advanceDedupeKey is deterministic — replaying the SAME stage twice produces the SAME key, which is what makes the DB UNIQUE constraint a no-op on the second insert', () => {
    const first = advanceDedupeKey('claimed')
    const second = advanceDedupeKey('claimed')
    expect(first).toBe(second)
  })

  test('correctionDedupeKey is prefixed and carries the given id, so two DIFFERENT corrections never collide', () => {
    const a = correctionDedupeKey('11111111-1111-1111-1111-111111111111')
    const b = correctionDedupeKey('22222222-2222-2222-2222-222222222222')
    expect(a).not.toBe(b)
    expect(isCorrectionDedupeKey(a)).toBe(true)
    expect(isCorrectionDedupeKey(b)).toBe(true)
  })

  test('isCorrectionDedupeKey is false for a plain stage-advance key (so the DB CHECK requiring a reason only ever fires for corrections)', () => {
    for (const stage of STAGES) expect(isCorrectionDedupeKey(advanceDedupeKey(stage))).toBe(false)
  })
})
