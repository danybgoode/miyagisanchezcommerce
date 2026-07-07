/**
 * Bookshop launchpad — shared types + the submission state machine.
 *
 * Deliberately next-free and side-effect-free (no `server-only`, no `db`, no
 * crypto) so the Playwright `api` runner can import and unit-test the pure
 * state-machine + sniff seams without loading a route. The DB/email/upload
 * plumbing lives in `lib/launchpad.ts` (server-only) which imports THIS.
 */

/** Curation lifecycle. Mirrors the print editorial queue's states, plus an
 *  explicit `changes_requested` return-to-writer state. */
export type SubmissionStatus =
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested'

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'changes_requested',
] as const

/** Allowed manuscript formats (Story 1.1). EPUB + DOCX are both ZIP containers —
 *  the sniff verifies the container, the extension disambiguates the two. */
export type ManuscriptFormat = 'pdf' | 'epub' | 'docx'
export const MANUSCRIPT_FORMATS: readonly ManuscriptFormat[] = ['pdf', 'epub', 'docx'] as const

/** Hard size cap for a manuscript upload (Story 1.1). Generous for a full book
 *  PDF while bounding the public, unauthenticated upload surface. */
export const MAX_MANUSCRIPT_SIZE_MB = 40

export interface LaunchpadSubmission {
  id: string
  shop_id: string
  medusa_seller_id: string
  status: SubmissionStatus
  title: string
  synopsis: string | null
  genre: string | null
  author_name: string
  author_email: string
  author_email_hash: string
  manuscript_key: string
  manuscript_name: string | null
  manuscript_format: ManuscriptFormat
  manuscript_size: number | null
  review_note: string | null
  published_product_id: string | null
  locale: string
  created_at: string
  updated_at: string
}

/**
 * The state machine, as an adjacency map: from → allowed next states.
 *
 * - `submitted` → the shop opens it (`in_review`), or acts directly.
 * - `in_review` → decide: approve / reject / ask for changes.
 * - `changes_requested` → the writer re-submits, which returns it to `submitted`.
 * - `approved` / `rejected` are terminal from the queue's POV (approved is then
 *   published in Story 1.3; a rejected work is done). `approved` still allows
 *   `changes_requested` so a shop can walk back a too-hasty approval before minting.
 */
const TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  submitted: ['in_review', 'approved', 'rejected', 'changes_requested'],
  in_review: ['approved', 'rejected', 'changes_requested'],
  changes_requested: ['submitted', 'rejected'],
  approved: ['changes_requested'],
  rejected: [],
}

/** Seller-initiated transitions (Story 1.2). A pure predicate — no I/O. */
export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  if (from === to) return false
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** The subset of statuses a shop can move a submission INTO via the review UI. */
export const REVIEWABLE_TARGET_STATUSES: readonly SubmissionStatus[] = [
  'in_review',
  'approved',
  'rejected',
  'changes_requested',
] as const

/** A transition that must carry a `review_note` for the writer (why rejected /
 *  what to change). Enforced in the route + asserted in the spec. */
export function transitionRequiresNote(to: SubmissionStatus): boolean {
  return to === 'rejected' || to === 'changes_requested'
}
