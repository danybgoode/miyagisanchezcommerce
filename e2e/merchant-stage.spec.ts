import { test, expect } from '@playwright/test'
import {
  STAGES,
  STAGE_ORDINAL,
  isStage,
  resolveStage,
  advanceDedupeKey,
  correctionDedupeKey,
  isCorrectionDedupeKey,
  factsAtOrAbove,
  mergeStageFacts,
  CONSENT_GATED_STAGES,
  shouldEmitStageTransition,
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

test.describe('factsAtOrAbove — permanent memory from a current stage (Sprint 3, Story 3.1)', () => {
  test('scouted (the baseline) grants no fact at all', () => {
    expect(factsAtOrAbove('scouted')).toEqual({})
  })

  test('every stage up to and including the given one is granted — resolveStage lands EXACTLY there', () => {
    for (const stage of STAGES) {
      const result = resolveStage(factsAtOrAbove(stage))
      expect(result.stage, stage).toBe(stage)
    }
  })

  test('a mid-chain stage does not grant anything PAST it', () => {
    const facts = factsAtOrAbove('claimed')
    expect(facts.paymentsReady).toBeUndefined()
    expect(facts.threeProductsLive).toBeUndefined()
    expect(facts.firstSale).toBeUndefined()
  })
})

test.describe('mergeStageFacts — OR semantics, true always wins (Sprint 3, Story 3.1)', () => {
  test('a fresh explicit false never erases a permanent true', () => {
    const permanent: StageFacts = { qualified: true, claimed: true }
    const fresh: StageFacts = { qualified: false, claimed: false, paymentsReady: true }
    const merged = mergeStageFacts(permanent, fresh)
    expect(merged.qualified).toBe(true)
    expect(merged.claimed).toBe(true)
    expect(merged.paymentsReady).toBe(true)
  })

  test('a fresh explicit undefined never erases a permanent true (the naive-spread bug this exists to avoid)', () => {
    const permanent: StageFacts = { qualified: true }
    const fresh: StageFacts = { qualified: undefined }
    expect(mergeStageFacts(permanent, fresh).qualified).toBe(true)
  })

  test('neither true → merged stays false/absent', () => {
    expect(mergeStageFacts({}, {}).qualified).toBeUndefined()
  })

  test('order of arguments does not matter (commutative)', () => {
    const a: StageFacts = { qualified: true }
    const b: StageFacts = { claimed: true }
    expect(mergeStageFacts(a, b)).toEqual(mergeStageFacts(b, a))
  })

  test('merging permanent memory with a resolveStage-confirmed advance never regresses the walk', () => {
    // The scenario `evaluateRelationship` relies on: a relationship already at
    // `three_products_live` (permanent), a fresh commerce read that — because
    // Medusa hiccupped — comes back with `threeProductsLive: undefined` this
    // run. The merge must still resolve at least as far as before.
    const permanent = factsAtOrAbove('three_products_live')
    const degradedFreshRead: StageFacts = {} // Medusa unreachable this run
    const merged = mergeStageFacts(permanent, degradedFreshRead)
    expect(resolveStage(merged).stage).toBe('three_products_live')
  })
})

test.describe('shouldEmitStageTransition — the consent gate (Sprint 3, Story 3.2)', () => {
  test('CONSENT_GATED_STAGES names exactly the two permission-gated stages', () => {
    expect([...CONSENT_GATED_STAGES].sort()).toEqual(['permission_granted', 'preview_delivered'])
  })

  test('an admin transition onto a gated stage WITHOUT live evidence does not emit', () => {
    expect(shouldEmitStageTransition('admin', 'permission_granted', false)).toBe(false)
    expect(shouldEmitStageTransition('admin', 'preview_delivered', false)).toBe(false)
  })

  test('an admin transition onto a gated stage WITH live evidence emits', () => {
    expect(shouldEmitStageTransition('admin', 'permission_granted', true)).toBe(true)
    expect(shouldEmitStageTransition('admin', 'preview_delivered', true)).toBe(true)
  })

  test('an admin transition onto a NON-gated stage emits regardless of evidence', () => {
    for (const stage of STAGES) {
      if (CONSENT_GATED_STAGES.has(stage)) continue
      expect(shouldEmitStageTransition('admin', stage, false), stage).toBe(true)
      expect(shouldEmitStageTransition('admin', stage, true), stage).toBe(true)
    }
  })

  test('a commerce_fact (derived-advance) transition onto a gated stage emits WITHOUT needing evidence', () => {
    // The derived-advance path's own evidence IS the fact that produced it
    // (the resolver already required `permissionGrantedEvidence`/
    // `previewDeliveredEvidence` to be true to reach this stage at all) — the
    // guard exists specifically for the admin correction route's UNCHECKED
    // write, not for the evaluator's own output.
    expect(shouldEmitStageTransition('commerce_fact', 'permission_granted', false)).toBe(true)
    expect(shouldEmitStageTransition('commerce_fact', 'preview_delivered', false)).toBe(true)
  })

  test('a system/promoter transition onto a gated stage also emits unconditionally', () => {
    expect(shouldEmitStageTransition('system', 'permission_granted', false)).toBe(true)
    expect(shouldEmitStageTransition('promoter', 'preview_delivered', false)).toBe(true)
  })

  test('every actor × every stage × both evidence values — exhaustive table, only "admin + gated + no evidence" refuses', () => {
    const actors: Array<'promoter' | 'admin' | 'system' | 'commerce_fact'> = ['promoter', 'admin', 'system', 'commerce_fact']
    for (const actor of actors) {
      for (const stage of STAGES) {
        for (const evidenced of [true, false]) {
          const result = shouldEmitStageTransition(actor, stage, evidenced)
          const shouldRefuse = actor === 'admin' && CONSENT_GATED_STAGES.has(stage) && !evidenced
          expect(result, `${actor}/${stage}/${evidenced}`).toBe(!shouldRefuse)
        }
      }
    }
  })
})
