/**
 * lib/relationship-consent.ts
 *
 * Founding merchant activation operations · Sprint 1 (Story 1.3) — the pure
 * consent-evidence rule for `POST /api/promoter/relationship/[id]/consent`.
 * Zero-import, same convention as `lib/merchant-identity.ts`, so the `api`
 * spec can walk every branch without a database.
 *
 * CORRECTED CONTRACT (S1 cross-review A1 — the original build contract's own
 * defect, not a builder mistake): consent must be decided from the same
 * source every other consent surface uses — `readApprovalState` in
 * `lib/preview-consent.ts`, whose own docstring calls it "the single read
 * every consent surface works from, so they can never disagree" — not from a
 * direct read of the append-only decision log. Two holes that direct read had:
 *
 *   (a) Invalidation does NOT bump `current_version`. `invalidateIfMaterialChange`
 *       sets `status='invalidated'` and clears `approved_snapshot_hash`/
 *       `approved_at` — it never touches `version`. A decision-log read keyed
 *       only on `(preview_id, version)` would still find the OLD approval row
 *       sitting at that same version and accept it, even though the anchor
 *       itself has moved on. `readApprovalState`'s `stale` flag is what
 *       actually tracks "does the live proposal still match what was
 *       approved" — that's the field this module now requires.
 *   (b) A flag-ON verified-approval requirement (`promoter.preview_verified_approval_enabled`,
 *       confirmed ON in production) means an approval with no merchant-verified
 *       provenance (`verified_via IS NULL`) is NOT a current approval — exactly
 *       the same rule `lib/preview-consent.ts#checkActivation` already enforces
 *       for publishing. Consent evidence for the RELATIONSHIP record must hold
 *       itself to the same bar as consent evidence for PUBLISHING, or the
 *       relationship record could show "permission granted" for an approval
 *       activation itself would refuse to trust.
 *
 * ROUND 2 (S1 cross-review B7): `status==='approved'` alone is too STRICT once
 * activation exists — `markActivated` (`lib/preview-consent.ts`) flips the
 * anchor to `status='activated'`, which is a one-way door (activation
 * revokes outstanding preview links; there is no path back to `approved`).
 * A version-strict `status !== 'approved'` check would therefore refuse
 * consent evidence FOREVER the instant a promoter activates the shop before
 * pressing "Registrar permiso" — stranding a record for a merchant who
 * demonstrably approved. `checkActivation` already special-cases `activated`
 * as idempotently valid (its own comment: "An already-activated preview stays
 * idempotently activatable"); this module mirrors that by accepting BOTH
 * `approved` and `activated` as the status gate. Fails closed, not a security
 * hole either way — `stale`/verified-provenance still apply on top.
 *
 * "A note is never evidence" still holds: nothing here reads `fit_note` /
 * `objections` / any free-text field.
 */

export interface ConsentEvidenceFacts {
  /** The preview anchor's own lifecycle status (`merchant_previews.status`). */
  status: string
  /** `readApprovalState(...).stale` — true when the live proposal no longer
   *  matches what was approved (a material edit, OR an invalidation that
   *  cleared the approval without bumping the version). */
  stale: boolean
  /** `readApprovalState(...).approvedVerifiedVia` — null for an unverified
   *  (legacy / flag-off) approval. */
  approvedVerifiedVia: 'email' | 'whatsapp' | null
}

/**
 * True only when the anchor-derived facts describe a CURRENT approval:
 * `status` is `approved` OR `activated` (B7 — activation is a one-way door,
 * so `activated` must count too or the record strands forever the instant a
 * promoter activates before recording consent) AND NOT stale, and — only when
 * verified-approval is being enforced — the approval also carries
 * merchant-verified provenance. `null` facts (the caller couldn't even read
 * the proposal) always refuses.
 */
export function consentSatisfiesEvidence(
  facts: ConsentEvidenceFacts | null,
  opts: { verifiedApprovalRequired: boolean },
): boolean {
  if (!facts) return false
  if (facts.status !== 'approved' && facts.status !== 'activated') return false
  if (facts.stale) return false
  if (opts.verifiedApprovalRequired && facts.approvedVerifiedVia === null) return false
  return true
}

/**
 * S1 cross-review A2: a caller-supplied (or fallback-resolved) `previewId` is
 * an ASSERTION to VERIFY, never a lookup key to trust. True only when the
 * preview's own `shop_id` matches the RELATIONSHIP's linked `shop_id` — a
 * relationship with no shop yet (`relationshipShopId === null`) can never
 * satisfy this, because there is nothing to verify the preview against, so an
 * unlinked relationship refuses consent evidence entirely rather than
 * trusting whatever preview id happens to be supplied. Without this, a
 * promoter holding two relationships (one genuinely approved, one never
 * contacted) could attach the approved preview's evidence to the OTHER
 * relationship — and per README D1, a relationship id is the opaque merchant
 * subject id every later sprint keys on.
 */
export function previewBelongsToRelationship(
  previewShopId: string,
  relationshipShopId: string | null,
): boolean {
  if (!relationshipShopId) return false
  return previewShopId === relationshipShopId
}
