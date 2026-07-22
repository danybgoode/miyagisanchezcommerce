import { test, expect } from '@playwright/test'
import {
  approvalCodeScope,
  issueApprovalCode,
  verifyApprovalCode,
  resolveDeliveryTarget,
  normalizePhone,
  hashContact,
  APPROVAL_CODE_MAX_ATTEMPTS,
  type StoredApprovalCode,
} from '../lib/preview-verification'

/**
 * Founding merchant consent-safe previews · Sprint 4 (api project, network-free) —
 * the pure code-binding logic for merchant-verified approval.
 *
 * The property under test: a code is bound to (preview id + approved snapshot hash
 * + contact). It cannot be replayed to approve a DIFFERENT proposal, cannot verify
 * once expired / exhausted / consumed, and its delivery target is the MERCHANT's
 * contact — never the promoter's.
 */

const PREVIEW = 'a1b2c3d4-0000-4000-8000-000000000000'
const SNAP_A = 'a'.repeat(64)
const SNAP_B = 'b'.repeat(64)

function storedFrom(issued: ReturnType<typeof issueApprovalCode>, over: Partial<StoredApprovalCode> = {}): StoredApprovalCode {
  return {
    snapshot_hash: SNAP_A,
    code_hash: issued.codeHash,
    contact_hash: issued.contactHash,
    attempts: 0,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null,
    ...over,
  }
}

test.describe('approval code — binding + verification', () => {
  test('a fresh code verifies against its own snapshot', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const r = verifyApprovalCode({ stored: storedFrom(issued), previewId: PREVIEW, currentSnapshotHash: SNAP_A, presentedCode: issued.code })
    expect(r.ok).toBe(true)
  })

  test('the plaintext code is never equal to its stored hash', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    expect(issued.codeHash).not.toBe(issued.code)
    expect(issued.contactHash).not.toContain('m@shop.mx')
  })

  test('REGRESSION: a code issued for snapshot A cannot approve snapshot B', () => {
    // The central promise — a code minted for the reviewed proposal must not
    // authorize approving a proposal that changed after the code was sent.
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const r = verifyApprovalCode({ stored: storedFrom(issued), previewId: PREVIEW, currentSnapshotHash: SNAP_B, presentedCode: issued.code })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('stale_snapshot')
  })

  test('a code for a DIFFERENT preview does not verify', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const other = 'ffffffff-0000-4000-8000-000000000000'
    const r = verifyApprovalCode({ stored: storedFrom(issued), previewId: other, currentSnapshotHash: SNAP_A, presentedCode: issued.code })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('mismatch') // scope differs → hash differs
  })

  test('a wrong code is a mismatch', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const r = verifyApprovalCode({ stored: storedFrom(issued), previewId: PREVIEW, currentSnapshotHash: SNAP_A, presentedCode: 'ZZZZZZ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('mismatch')
  })

  test('an expired code is rejected', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const stored = storedFrom(issued, { expires_at: new Date(Date.now() - 1000).toISOString() })
    const r = verifyApprovalCode({ stored, previewId: PREVIEW, currentSnapshotHash: SNAP_A, presentedCode: issued.code })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  test('an already-consumed code is treated as absent', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const stored = storedFrom(issued, { consumed_at: new Date().toISOString() })
    const r = verifyApprovalCode({ stored, previewId: PREVIEW, currentSnapshotHash: SNAP_A, presentedCode: issued.code })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_code')
  })

  test('the attempt ceiling kills a code', () => {
    const issued = issueApprovalCode({ previewId: PREVIEW, snapshotHash: SNAP_A, contact: 'm@shop.mx', channel: 'email' })
    const stored = storedFrom(issued, { attempts: APPROVAL_CODE_MAX_ATTEMPTS })
    const r = verifyApprovalCode({ stored, previewId: PREVIEW, currentSnapshotHash: SNAP_A, presentedCode: issued.code })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_many_attempts')
  })

  test('a missing stored row is no_code', () => {
    const r = verifyApprovalCode({ stored: null, previewId: PREVIEW, currentSnapshotHash: SNAP_A, presentedCode: 'ABCDEF' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_code')
  })

  test('the scope encodes both preview and snapshot (a change to either changes it)', () => {
    expect(approvalCodeScope(PREVIEW, SNAP_A)).not.toBe(approvalCodeScope(PREVIEW, SNAP_B))
    expect(approvalCodeScope(PREVIEW, SNAP_A)).not.toBe(approvalCodeScope('other', SNAP_A))
  })
})

test.describe('delivery target — the code must reach the MERCHANT, never the promoter', () => {
  test('email is primary when present + valid', () => {
    const t = resolveDeliveryTarget({ merchantEmail: 'Merchant@Shop.MX', merchantPhone: '5512345678' })
    expect(t).toEqual({ channel: 'email', contact: 'merchant@shop.mx' })
  })

  test('falls back to a valid merchant WhatsApp number when there is no email', () => {
    const t = resolveDeliveryTarget({ merchantEmail: null, merchantPhone: '55 1234 5678' })
    expect(t).toEqual({ channel: 'whatsapp', contact: '525512345678' })
  })

  test('REFUSES (null) when neither a valid email nor a real merchant phone is on file', () => {
    // This is the consent-critical case: without a merchant-controlled contact there
    // is nothing to prove possession of, so the caller must refuse — never fall back
    // to the promoter or "deliver" to nothing.
    expect(resolveDeliveryTarget({ merchantEmail: null, merchantPhone: null })).toBeNull()
    expect(resolveDeliveryTarget({ merchantEmail: '   ', merchantPhone: '123' })).toBeNull()
    expect(resolveDeliveryTarget({ merchantEmail: 'not-an-email', merchantPhone: '' })).toBeNull()
  })

  test('a too-short phone is not a deliverable number', () => {
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('5512345678')).toBe('525512345678')
    expect(normalizePhone('525512345678')).toBe('525512345678')
  })

  test('the contact hash never contains the raw contact', () => {
    const h = hashContact('merchant@shop.mx')
    expect(h).not.toContain('merchant@shop.mx')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
