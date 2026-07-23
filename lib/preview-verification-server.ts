/**
 * lib/preview-verification-server.ts
 *
 * Founding merchant consent-safe previews · Sprint 4 — the server composition for
 * merchant-verified approval: persist a code, deliver it to the MERCHANT's own
 * contact, and verify a presented code against the live proposal.
 *
 * Composes the pure logic in lib/preview-verification.ts with Supabase + the email
 * sender. Runtime: Node only (service-role Supabase client).
 *
 * DELIVERY CHANNEL REALITY (important): the guarantee this sprint provides is that
 * the code reaches a channel the MERCHANT controls, so the promoter can't self-
 * approve. Email satisfies that — the server sends directly to the merchant's
 * inbox; the promoter never sees the code. WhatsApp does NOT yet: there is no
 * server-side WhatsApp send in this codebase (only client `wa.me` share links,
 * which would route the code THROUGH the promoter's device and defeat the point),
 * and no merchant phone is captured anywhere today. So WhatsApp delivery is
 * deliberately DEFERRED here — `resolveDeliveryTarget` and the DB channel enum
 * already support it, but the server refuses to "deliver" a code by a channel it
 * can't send on without leaking it. Email is the live path; WhatsApp lights up when
 * a server-side send + merchant-phone capture exist.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { sendPreviewApprovalCode } from '@/lib/email'
import type { MerchantPreview } from '@/lib/preview-access'
import { readApprovalState } from '@/lib/preview-consent'
import {
  issueApprovalCode,
  approvalCodeScope,
  hashPresentedCode,
  resolveDeliveryTarget,
  APPROVAL_CODE_MAX_ATTEMPTS,
  type VerificationChannel,
} from '@/lib/preview-verification'

export type StartVerificationResult =
  | { ok: true; channel: VerificationChannel }
  | { ok: false; reason: 'no_proposal' | 'no_contact' | 'unsupported_channel' | 'persist_failed' | 'send_failed' }

/**
 * Read the merchant's contact facts from the shop mirror. Only the raw values the
 * delivery resolver needs — never surfaced to any client. Phone is read for
 * forward-compatibility; nothing writes it yet (see the channel-reality note).
 */
async function readMerchantContact(shopId: string): Promise<{ email: string | null; phone: string | null }> {
  const { data } = await db.from('marketplace_shops').select('metadata').eq('id', shopId).maybeSingle()
  const meta = (data?.metadata ?? {}) as Record<string, unknown>
  return {
    email: typeof meta.merchant_email === 'string' ? meta.merchant_email : null,
    phone: typeof meta.merchant_phone === 'string' ? meta.merchant_phone : null,
  }
}

/**
 * Issue + deliver an approval code for the CURRENT proposal. Binds the code to the
 * live snapshot hash, so a code sent now can only approve the proposal as it stands
 * now. Invalidates any prior unconsumed code for the preview first (issuing a new
 * code supersedes the old one). Never returns or logs the code.
 */
export async function startApprovalVerification(preview: MerchantPreview): Promise<StartVerificationResult> {
  const state = await readApprovalState(preview)
  if (!state) return { ok: false, reason: 'no_proposal' }

  const contact = await readMerchantContact(preview.shopId)
  const target = resolveDeliveryTarget({ merchantEmail: contact.email, merchantPhone: contact.phone })
  // No merchant-controlled contact on file → refuse. Never fall back to the
  // promoter; without a merchant contact there is nothing to prove possession of.
  if (!target) return { ok: false, reason: 'no_contact' }

  // Email is the only channel the server can actually deliver on without routing
  // the code through the promoter. WhatsApp is resolved (forward-compat) but not
  // yet deliverable — refuse rather than leak.
  if (target.channel !== 'email') return { ok: false, reason: 'unsupported_channel' }

  const issued = issueApprovalCode({
    previewId: preview.id,
    snapshotHash: state.currentHash,
    contact: target.contact,
    channel: target.channel,
  })

  // Supersede any prior unconsumed code for this preview, then persist the new one
  // BEFORE sending (so a send that races a read can't verify against an absent row).
  await db
    .from('merchant_preview_approval_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('preview_id', preview.id)
    .is('consumed_at', null)

  const { error: insertError } = await db.from('merchant_preview_approval_codes').insert({
    preview_id: preview.id,
    snapshot_hash: state.currentHash,
    code_hash: issued.codeHash,
    contact_hash: issued.contactHash,
    channel: issued.channel,
    expires_at: issued.expiresAt,
  })
  if (insertError) return { ok: false, reason: 'persist_failed' }

  try {
    const presentation = state.snapshot
    await sendPreviewApprovalCode({ to: target.contact, code: issued.code, shopName: presentation.shopName })
  } catch {
    return { ok: false, reason: 'send_failed' }
  }

  return { ok: true, channel: target.channel }
}

export type ConsumeResult =
  | { ok: true; channel: VerificationChannel; contactHash: string }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'stale_snapshot' | 'mismatch' }

/**
 * Verify a presented code against the CURRENT proposal and CONSUME it on success.
 * On a mismatch, increments the attempt counter (5-attempt ceiling). Returns the
 * channel + contact hash so the caller can stamp the consent record's
 * `verified_via` / `verified_contact_hash`. The decision route calls this and only
 * records an `approved` decision when it returns ok.
 */
export async function consumeApprovalCode(input: {
  preview: MerchantPreview
  currentSnapshotHash: string
  presentedCode: string
}): Promise<ConsumeResult> {
  // ATOMIC verify-and-consume via the DB function. The app computes the expected
  // code hash (it holds the HMAC secret) and hands it to the RPC, which does the
  // compare + the state transition in ONE locked statement. This closes the
  // read-then-update races a JS-side check has (cross-agent review, 2026-07-22):
  //   * two requests can't both consume the same code,
  //   * parallel wrong guesses each burn an attempt (no lost increments),
  //   * an expired / stale / exhausted / already-consumed code can't be consumed.
  const expectedHash = hashPresentedCode({
    previewId: input.preview.id,
    snapshotHash: input.currentSnapshotHash,
    code: input.presentedCode,
  })

  const { data, error } = await db.rpc('consume_preview_approval_code', {
    p_preview_id: input.preview.id,
    p_snapshot_hash: input.currentSnapshotHash,
    p_expected_hash: expectedHash,
  })
  if (error) return { ok: false, reason: 'no_code' } // fail closed — no approval

  // The RPC returns a single row: { outcome, channel, contact_hash }.
  const row = Array.isArray(data) ? data[0] : data
  const outcome = (row?.outcome ?? 'no_code') as string
  if (outcome === 'ok') {
    return { ok: true, channel: row.channel as VerificationChannel, contactHash: row.contact_hash as string }
  }
  const known = ['no_code', 'expired', 'too_many_attempts', 'stale_snapshot', 'mismatch'] as const
  const reason = (known as readonly string[]).includes(outcome)
    ? (outcome as (typeof known)[number])
    : 'no_code'
  return { ok: false, reason }
}

export { APPROVAL_CODE_MAX_ATTEMPTS }
