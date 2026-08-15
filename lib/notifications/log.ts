/**
 * The outbound-notification ledger.
 *
 * NOTE: deliberately NOT `import 'server-only'`, matching `lib/supabase.ts`,
 * `lib/email.ts` and `lib/telegram.ts` — the three transports that import it. Those
 * are imported by the Playwright `api` specs, and a `server-only` marker here makes
 * the whole gate fail to load. The service-role client it uses is already
 * unreachable from a browser (its key has no `NEXT_PUBLIC_` prefix, so it is
 * undefined there), which is the same protection those siblings rely on.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Auditing one order on 2026-08-15 meant reconstructing "who was told what" from
 * Cloud Run access logs, because nothing recorded it anywhere. Production's Resend
 * key is send-only (reads answer 401), so the provider's own log was closed too.
 * Four separate delivery failures had been silent for weeks and none of them was
 * discoverable after the fact — only inferable.
 *
 * Written at the three real TRANSPORTS, not at the ~65 senders, so a new sender is
 * covered for free and none of them can forget.
 *
 * ── RULES ────────────────────────────────────────────────────────────────────
 * 1. NEVER throws and never blocks a send. A ledger that can break delivery is
 *    worse than no ledger.
 * 2. Records skips and failures, not only sends. "We never tried" and "we tried and
 *    it bounced" are different facts; an absent row cannot tell them apart, which is
 *    the exact ambiguity this exists to remove.
 */
import { db } from '@/lib/supabase'

export type NotificationChannel = 'email' | 'push' | 'telegram'
export type NotificationOutcome = 'sent' | 'skipped' | 'failed'

export type NotificationLogEntry = {
  channel: NotificationChannel
  outcome: NotificationOutcome
  recipient?: string | null
  clerkUserId?: string | null
  subject?: string | null
  /** Required whenever `outcome` is not 'sent' — the whole point of the row. */
  reason?: string | null
  providerId?: string | null
  context?: Record<string, unknown> | null
}

export function logNotification(entry: NotificationLogEntry): void {
  // Deliberately not awaited by callers: the transports are on request paths and a
  // ledger write must never add latency to, or fail, a notification.
  void (async () => {
    try {
      const { error } = await db.from('notification_log').insert({
        channel: entry.channel,
        outcome: entry.outcome,
        recipient: entry.recipient ?? null,
        clerk_user_id: entry.clerkUserId ?? null,
        subject: entry.subject ?? null,
        reason: entry.reason ?? null,
        provider_id: entry.providerId ?? null,
        context: entry.context ?? null,
      })
      if (error) {
        // One level of honesty about the honesty layer. If the ledger itself is
        // failing, the console is the only place left to say so.
        console.error('[notification-log] insert failed:', error.message)
      }
    } catch (e) {
      console.error('[notification-log] threw:', e)
    }
  })()
}
