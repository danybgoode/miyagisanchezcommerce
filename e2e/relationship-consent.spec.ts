import { test, expect } from '@playwright/test'
import { consentSatisfiesEvidence, type ConsentDecisionFact } from '../lib/relationship-consent'

/**
 * Founding merchant activation operations · Sprint 1, Story 1.3 (api project,
 * network-free): the pure consent-evidence rule
 * `POST /api/promoter/relationship/[id]/consent` refuses on. "A note is never
 * evidence" — every refusing branch here is a shape a promoter's free-text
 * note could plausibly take, and none of them pass.
 */

test.describe('consentSatisfiesEvidence — the build contract, literally', () => {
  test('no decision row at all → refused (never assume silence is consent)', () => {
    expect(consentSatisfiesEvidence(null, 3)).toBe(false)
  })

  test('a changes_requested decision at the current version → refused', () => {
    const decision: ConsentDecisionFact = { decision: 'changes_requested', version: 3 }
    expect(consentSatisfiesEvidence(decision, 3)).toBe(false)
  })

  test('an approval at a STALE version (not the preview\'s current one) → refused', () => {
    const decision: ConsentDecisionFact = { decision: 'approved', version: 2 }
    expect(consentSatisfiesEvidence(decision, 3)).toBe(false)
  })

  test('an approval at the CURRENT version → satisfied', () => {
    const decision: ConsentDecisionFact = { decision: 'approved', version: 3 }
    expect(consentSatisfiesEvidence(decision, 3)).toBe(true)
  })

  test('an arbitrary free-text "decision" value (never a real enum value) → refused', () => {
    const decision = { decision: 'el comerciante dijo que sí de palabra', version: 3 } as ConsentDecisionFact
    expect(consentSatisfiesEvidence(decision, 3)).toBe(false)
  })
})
