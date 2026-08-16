/**
 * POST /api/admin/comunicaciones/broadcast — one operational message to every
 * seller or every buyer.
 *
 * Clerk-admin gated by `withAdmin`, which 401s before this handler runs and writes
 * an `admin_audit_log` row on success.
 *
 * ── TWO VERBS, AND THE SECOND CANNOT RUN BLIND ───────────────────────────────
 *   mode: 'preview'  fully read-only. Resolves the list, renders nothing, sends
 *                    nothing. Returns the recipients so the operator SEES them.
 *   mode: 'send'     requires the literal confirmation phrase AND the exact
 *                    recipient count the preview returned. A list that changed in
 *                    between is refused, not sent to — it is a different send than
 *                    the one that was approved.
 *
 * ── DECIDE BEFORE ANY WRITE ──────────────────────────────────────────────────
 * The draft is validated, the list resolved, and the send gated — all before the
 * transport is touched. Nothing here can half-send.
 *
 * ── REPORTING ────────────────────────────────────────────────────────────────
 * Every address is reported as `sent` or `failed` individually. A partial send is
 * reported as partial; one bad address never fails the batch, and never lets the
 * batch claim it succeeded. Each attempt also lands in `notification_log` for free,
 * because the transport writes it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { sendPlatformBroadcast } from '@/lib/email'
import {
  bodyParagraphs,
  decideBroadcastDraft,
  decideBroadcastSend,
  BROADCAST_MAX_RECIPIENTS,
} from '@/lib/notifications/broadcast'
import { resolveBroadcastRecipients } from '@/lib/notifications/broadcast-recipients'

export const dynamic = 'force-dynamic'

export const POST = withAdmin(async (req: NextRequest) => {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const body = (raw ?? {}) as Record<string, unknown>

  // 1. DECIDE — the draft is well-formed, before anything is read or sent.
  const decision = decideBroadcastDraft(body)
  if (!decision.ok) {
    return NextResponse.json({ error: decision.message, field: decision.field }, { status: decision.status })
  }
  const { draft } = decision

  // 2. RESOLVE — who this reaches. An unreadable audience is an error, never [].
  const resolution = await resolveBroadcastRecipients(draft.audience)
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.message }, { status: 503 })
  }
  const { recipients, skipped } = resolution
  const paragraphs = bodyParagraphs(draft.body)

  if (body.mode !== 'send') {
    return NextResponse.json({
      mode: 'preview',
      audience: draft.audience,
      count: recipients.length,
      max: BROADCAST_MAX_RECIPIENTS,
      recipients: recipients.map((r) => ({ email: r.email, label: r.label })),
      // Named, not dropped: "we cannot reach 8 of your shops" is something an
      // operator should know BEFORE deciding the message is delivered.
      skipped,
      preview: { subject: draft.subject, headline: draft.headline, paragraphs, ctaLabel: draft.ctaLabel, ctaUrl: draft.ctaUrl },
    })
  }

  // 3. GATE — confirmed, non-empty, unchanged since the preview, under the cap.
  const gate = decideBroadcastSend({
    confirm: body.confirm,
    expectedCount: body.expectedCount,
    resolvedCount: recipients.length,
  })
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status })
  }

  // 4. SEND — sequentially, per address, each outcome recorded on its own.
  const results: Array<{ email: string; ok: boolean; error?: string }> = []
  for (const recipient of recipients) {
    try {
      await sendPlatformBroadcast({
        to: recipient.email,
        subject: draft.subject,
        headline: draft.headline,
        paragraphs,
        ctaLabel: draft.ctaLabel,
        ctaUrl: draft.ctaUrl,
      })
      results.push({ email: recipient.email, ok: true })
    } catch (e) {
      results.push({ email: recipient.email, ok: false, error: e instanceof Error ? e.message : 'error' })
    }
  }

  const sent = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)

  return NextResponse.json({
    mode: 'send',
    audience: draft.audience,
    sent,
    // A partial send reports as partial. "Listo" over 12 of 14 is the
    // report-must-match-what-happened failure this codebase has paid for repeatedly.
    failed: failed.length,
    complete: failed.length === 0,
    failures: failed,
  })
})
