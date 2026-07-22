/**
 * lib/preview-verification.ts
 *
 * Founding merchant consent-safe previews · Sprint 4 — the PURE binding + delivery
 * logic for merchant-verified approval.
 *
 * Deliberately ZERO app imports beyond the shared crypto in lib/sweepstakes.ts
 * (which is itself next-free) so the rule that governs whether an approval code is
 * valid is directly unit-testable from a Playwright `api` spec — same discipline as
 * lib/preview-snapshot.ts. `lib/preview-verification-server.ts` composes these with
 * the DB + email/WhatsApp senders.
 *
 * The property this module protects: a code is bound to (preview id + the exact
 * approved snapshot hash + the contact it was sent to). So a code cannot be
 * replayed to approve a DIFFERENT proposal than the one it was issued for, and the
 * consent record can name which contact proved the approval — without ever storing
 * the raw code or the raw contact.
 */
import {
  makeCode,
  hashVerificationCode,
  hashSweepstakesEmail,
  cleanEmail,
  isValidEmail,
  safeCompare,
} from '@/lib/sweepstakes'

/** How an approval code may be delivered. Never SMS (see sprint-4.md). */
export type VerificationChannel = 'email' | 'whatsapp'

/** 15-minute code lifetime — identical to the launchpad/sweepstakes flows. */
export const APPROVAL_CODE_TTL_MS = 15 * 60 * 1000

/** Attempt ceiling before a code is dead — identical to the sibling flows. */
export const APPROVAL_CODE_MAX_ATTEMPTS = 5

/**
 * The scope a code is bound to. Encoding preview id + snapshot hash into the scope
 * means the code hash is DIFFERENT if the proposal changed — so a code issued for
 * snapshot A cannot verify an approval whose live snapshot is B, and a code for
 * preview X cannot verify preview Y. The whole point of versioned, verified consent.
 *
 * Deliberately does NOT fold the contact into the hash: the code is delivered to a
 * specific contact (recorded in the `contact_hash` COLUMN for provenance), and
 * possession of the delivered code is the proof. Keeping contact out of the HASH is
 * what lets the server compute the expected hash from request context alone
 * (preview id + snapshot + code) and hand it to the atomic verify-and-consume RPC —
 * no read-then-compute-then-update race.
 */
export function approvalCodeScope(previewId: string, snapshotHash: string): string {
  return `preview-approval:${previewId}:${snapshotHash}`
}

/** Fixed placeholder for the shared `hashVerificationCode` contact slot — contact
 *  is intentionally not part of the code hash (see `approvalCodeScope`). */
const NO_CONTACT_IN_HASH = ''

/** Hash a contact (email or E.164 phone) for provable-but-not-stored linkage. */
export function hashContact(contact: string): string {
  return hashSweepstakesEmail(contact) // HMAC over the normalized contact
}

/**
 * Normalize a phone number toward E.164-ish digits for a WhatsApp delivery. Returns
 * null when there aren't enough digits to be a real number — the caller refuses
 * rather than "deliver" to nothing (a promoter must not be able to self-send).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  // Mexican numbers are 10 digits (or 12 with a 52 country code). Require ≥10.
  if (digits.length < 10) return null
  return digits.length === 10 ? `52${digits}` : digits
}

export interface IssuedCode {
  code: string
  codeHash: string
  contactHash: string
  channel: VerificationChannel
  expiresAt: string
}

/**
 * Mint a code bound to (preview, snapshot, contact). Pure: returns the plaintext
 * `code` (to deliver, once) plus the hashes to persist. The caller never stores the
 * plaintext. `contact` is a normalized email or phone; the channel decides which.
 */
export function issueApprovalCode(input: {
  previewId: string
  snapshotHash: string
  contact: string
  channel: VerificationChannel
}): IssuedCode {
  const scope = approvalCodeScope(input.previewId, input.snapshotHash)
  const contactHash = hashContact(input.contact)
  const code = makeCode()
  return {
    code,
    codeHash: hashVerificationCode(scope, NO_CONTACT_IN_HASH, code),
    contactHash,
    channel: input.channel,
    expiresAt: new Date(Date.now() + APPROVAL_CODE_TTL_MS).toISOString(),
  }
}

/**
 * Compute the hash a PRESENTED code would have, for the (preview, snapshot,
 * contact) it must match. The server passes this into the atomic
 * `consume_preview_approval_code` RPC so the compare + state transition happen in
 * one locked statement (no read-then-update race). Same HMAC as `issueApprovalCode`.
 */
export function hashPresentedCode(input: {
  previewId: string
  snapshotHash: string
  code: string
}): string {
  return hashVerificationCode(approvalCodeScope(input.previewId, input.snapshotHash), NO_CONTACT_IN_HASH, input.code)
}

/** The stored code row, as the verify path reads it. */
export interface StoredApprovalCode {
  snapshot_hash: string
  code_hash: string
  contact_hash: string
  attempts: number
  expires_at: string
  consumed_at: string | null
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'stale_snapshot' | 'mismatch' }

/**
 * Decide whether a presented code verifies against a stored row, FOR the snapshot
 * being approved right now. Pure — the server layer does the read, the attempt
 * increment and the consume; this holds every rule so the route and the spec agree.
 *
 * Ordering matters: a stale-snapshot code (issued for a proposal that has since
 * changed) is rejected as `stale_snapshot` BEFORE the code even gets compared, so a
 * merchant can't approve an edited proposal with a code minted for the old one.
 */
export function verifyApprovalCode(input: {
  stored: StoredApprovalCode | null
  previewId: string
  currentSnapshotHash: string
  presentedCode: string
  now?: number
}): VerifyOutcome {
  const now = input.now ?? Date.now()
  const s = input.stored
  if (!s) return { ok: false, reason: 'no_code' }
  if (s.consumed_at) return { ok: false, reason: 'no_code' } // already used → treat as absent
  if (new Date(s.expires_at).getTime() < now) return { ok: false, reason: 'expired' }
  if (s.attempts >= APPROVAL_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' }
  // The code was issued for a specific snapshot; if the live proposal moved, the
  // code can't authorize approving the new one.
  if (s.snapshot_hash !== input.currentSnapshotHash) return { ok: false, reason: 'stale_snapshot' }

  const expected = hashPresentedCode({
    previewId: input.previewId,
    snapshotHash: input.currentSnapshotHash,
    code: input.presentedCode,
  })
  if (!safeCompare(expected, s.code_hash)) return { ok: false, reason: 'mismatch' }
  return { ok: true }
}

/**
 * Resolve which contact + channel a code should go to, given what the shop has on
 * file. Email is primary. WhatsApp is a fallback that MUST target the merchant's
 * own number — never the promoter's — so a missing/invalid merchant phone yields
 * `null` (the caller refuses) rather than falling back to anyone else.
 *
 * `isValidEmail` / `cleanEmail` reused from the sweepstakes flow.
 */
export function resolveDeliveryTarget(input: {
  merchantEmail: string | null | undefined
  merchantPhone: string | null | undefined
}): { channel: VerificationChannel; contact: string } | null {
  const email = (input.merchantEmail ?? '').trim()
  if (email && isValidEmail(email)) return { channel: 'email', contact: cleanEmail(email) }
  const phone = normalizePhone(input.merchantPhone)
  if (phone) return { channel: 'whatsapp', contact: phone }
  return null
}
