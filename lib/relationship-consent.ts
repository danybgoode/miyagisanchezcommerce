/**
 * lib/relationship-consent.ts
 *
 * Founding merchant activation operations · Sprint 1 (Story 1.3) — the pure
 * consent-evidence rule for `POST /api/promoter/relationship/[id]/consent`.
 * Zero-import, same convention as `lib/merchant-identity.ts`, so the `api`
 * spec can walk every branch without a database.
 *
 * The build contract is literal: the route reads `merchant_preview_decisions`
 * for the linked preview and requires `decision='approved'` AT THE PREVIEW'S
 * `current_version` — anything else (no row, a `changes_requested` note, an
 * approval recorded at a version the merchant has since moved on from) is
 * refused. "A note is never evidence" — there is no branch here that accepts
 * anything but an approval at the exact current version.
 */

export interface ConsentDecisionFact {
  decision: string
  version: number
}

/**
 * True only when `decision` is an APPROVAL recorded at the preview's CURRENT
 * version. `null` (no decision row for this preview at all) always refuses.
 */
export function consentSatisfiesEvidence(
  decision: ConsentDecisionFact | null,
  currentVersion: number,
): boolean {
  if (!decision) return false
  if (decision.decision !== 'approved') return false
  return decision.version === currentVersion
}
