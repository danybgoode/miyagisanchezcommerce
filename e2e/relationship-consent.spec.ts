import { test, expect } from '@playwright/test'
import {
  consentSatisfiesEvidence,
  previewBelongsToRelationship,
  type ConsentEvidenceFacts,
} from '../lib/relationship-consent'

/**
 * Founding merchant activation operations · Sprint 1, Story 1.3 (api project,
 * network-free): the pure consent-evidence rule
 * `POST /api/promoter/relationship/[id]/consent` refuses on.
 *
 * S1 cross-review A1 (a defect in the ORIGINAL build contract, corrected in
 * sprint-1.md): evidence is decided from `readApprovalState`-shaped facts
 * (status + stale + approvedVerifiedVia), not a raw decision-log row keyed on
 * `(preview_id, version)` — that shape couldn't express either of the two
 * cases this file exists to cover:
 *   - a STALE anchor (invalidation clears the approval WITHOUT bumping the
 *     version, so a version-keyed check alone would have kept accepting it);
 *   - an approval recorded with no merchant-verified provenance while
 *     `promoter.preview_verified_approval_enabled` is enforced (verified live
 *     ON in production — not hypothetical).
 *
 * "A note is never evidence" still holds: every refusing branch here is a
 * shape a promoter's free-text note could plausibly coincide with, and none
 * of them pass.
 */

test.describe('consentSatisfiesEvidence — the corrected build contract, literally', () => {
  const notRequired = { verifiedApprovalRequired: false }
  const required = { verifiedApprovalRequired: true }

  test('no facts at all (the proposal itself could not be read) → refused', () => {
    expect(consentSatisfiesEvidence(null, notRequired)).toBe(false)
  })

  test('status !== approved (e.g. changes_requested) → refused, regardless of stale/verified', () => {
    const facts: ConsentEvidenceFacts = { status: 'changes_requested', stale: false, approvedVerifiedVia: 'email' }
    expect(consentSatisfiesEvidence(facts, notRequired)).toBe(false)
  })

  test('an arbitrary free-text "status" value (never a real anchor state) → refused', () => {
    const facts = { status: 'el comerciante dijo que sí de palabra', stale: false, approvedVerifiedVia: null } as ConsentEvidenceFacts
    expect(consentSatisfiesEvidence(facts, notRequired)).toBe(false)
  })

  test('STALE approval → refused even though status is approved (A1a: invalidation never bumps version, so `stale` is the only signal that catches it)', () => {
    const facts: ConsentEvidenceFacts = { status: 'approved', stale: true, approvedVerifiedVia: 'email' }
    expect(consentSatisfiesEvidence(facts, notRequired)).toBe(false)
  })

  test('a CURRENT (non-stale) approval, verification NOT required → satisfied even with no verified provenance', () => {
    const facts: ConsentEvidenceFacts = { status: 'approved', stale: false, approvedVerifiedVia: null }
    expect(consentSatisfiesEvidence(facts, notRequired)).toBe(true)
  })

  test('A1b: a CURRENT approval with NO verified provenance, verification REQUIRED (flag ON) → refused', () => {
    const facts: ConsentEvidenceFacts = { status: 'approved', stale: false, approvedVerifiedVia: null }
    expect(consentSatisfiesEvidence(facts, required)).toBe(false)
  })

  test('a CURRENT, VERIFIED approval, verification required → satisfied (email or whatsapp)', () => {
    for (const via of ['email', 'whatsapp'] as const) {
      const facts: ConsentEvidenceFacts = { status: 'approved', stale: false, approvedVerifiedVia: via }
      expect(consentSatisfiesEvidence(facts, required)).toBe(true)
    }
  })

  test('stale AND verification required → still refused on staleness first (both holes independently block)', () => {
    const facts: ConsentEvidenceFacts = { status: 'approved', stale: true, approvedVerifiedVia: 'whatsapp' }
    expect(consentSatisfiesEvidence(facts, required)).toBe(false)
  })
})

/**
 * S1 cross-review round 2 · B7 — activation is a ONE-WAY door
 * (`markActivated` flips `status='approved' → 'activated'`; there is no path
 * back). A status check that only ever accepted `'approved'` would refuse
 * consent evidence FOREVER the instant a promoter activates the shop before
 * pressing "Registrar permiso" — stranding a record for a merchant who
 * demonstrably approved. `checkActivation` already special-cases `activated`
 * as idempotently valid; this mirrors it.
 */
test.describe('consentSatisfiesEvidence — B7: activated is a valid status, not just approved', () => {
  const notRequired = { verifiedApprovalRequired: false }
  const required = { verifiedApprovalRequired: true }

  test('a CURRENT (non-stale) activated preview, verification NOT required → satisfied', () => {
    const facts: ConsentEvidenceFacts = { status: 'activated', stale: false, approvedVerifiedVia: null }
    expect(consentSatisfiesEvidence(facts, notRequired)).toBe(true)
  })

  test('a CURRENT, VERIFIED activated preview, verification required → satisfied', () => {
    const facts: ConsentEvidenceFacts = { status: 'activated', stale: false, approvedVerifiedVia: 'email' }
    expect(consentSatisfiesEvidence(facts, required)).toBe(true)
  })

  test('an activated preview with NO verified provenance, verification required → still refused (activation does not bypass verification)', () => {
    const facts: ConsentEvidenceFacts = { status: 'activated', stale: false, approvedVerifiedVia: null }
    expect(consentSatisfiesEvidence(facts, required)).toBe(false)
  })

  test('a STALE activated preview → still refused (activation does not bypass staleness either)', () => {
    const facts: ConsentEvidenceFacts = { status: 'activated', stale: true, approvedVerifiedVia: 'email' }
    expect(consentSatisfiesEvidence(facts, notRequired)).toBe(false)
  })

  test('every OTHER status (draft/delivered/changes_requested/invalidated) still refuses', () => {
    for (const status of ['draft', 'delivered', 'changes_requested', 'invalidated']) {
      const facts: ConsentEvidenceFacts = { status, stale: false, approvedVerifiedVia: 'email' }
      expect(consentSatisfiesEvidence(facts, notRequired)).toBe(false)
    }
  })
})

/**
 * S1 cross-review A2 — the CROSS-RELATIONSHIP hole: a promoter holding two
 * relationships (R_A genuinely approved, R_B never contacted) posts R_A's
 * preview id against R_B. `previewBelongsToRelationship` is the ONE gate that
 * refuses it, exercised here at every branch a spec can reach without a
 * database — the route-level DB read is owed to Daniel (no two-promoter,
 * two-relationship fixture exists in this harness), but the DECISION itself
 * is fully covered.
 */
test.describe('previewBelongsToRelationship — A2, the cross-relationship binding check', () => {
  test('relationship has NO shop yet → refused (nothing to verify the preview against)', () => {
    expect(previewBelongsToRelationship('shop-A', null)).toBe(false)
  })

  test("preview's shop does not match the relationship's shop (the exploit shape) → refused", () => {
    expect(previewBelongsToRelationship('shop-A', 'shop-B')).toBe(false)
  })

  test("preview's shop DOES match the relationship's shop → satisfied", () => {
    expect(previewBelongsToRelationship('shop-A', 'shop-A')).toBe(true)
  })
})
