import 'server-only'
import webpush from 'web-push'
import { db } from '@/lib/supabase'

/**
 * Notification seam. Today: VAPID web push. Swappable to Novu/etc. later —
 * callers only ever use `notify()`, never the transport. Server-only.
 */

let configured = false
function ensureVapid(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:soporte@miyagisanchez.com', pub, priv)
    configured = true
  }
  return true
}

/**
 * Is web push actually CONFIGURED (VAPID keys present)?
 *
 * Additive and deliberately NOT a change to `notify()`'s `Promise<void>`
 * fire-and-forget contract, which every existing caller relies on.
 *
 * It exists because `notify()` returns SILENTLY when VAPID is unset — so a caller
 * that must record a DELIVERY OUTCOME cannot distinguish "sent" from "there is no
 * push transport on this deploy". The portfolio reminder rail
 * (merchant-partner-lifecycle S2.2) needs that difference: a reminder nobody could
 * receive has to be recorded as failed, not reported as sent (cross-agent review
 * round 2, PR 310 — my first fix pre-checked the SUBSCRIPTION but not the
 * TRANSPORT, so "valid subscription + missing VAPID" still recorded a false
 * success).
 *
 * Answers "could we even try?", never "did it arrive".
 */
export function pushConfigured(): boolean {
  return ensureVapid()
}

export type NotifyEvent = {
  // 'portfolio_reminder' added (Merchant Partner lifecycle · Sprint 2, Story
  // 2.2) — a STEWARD-directed reminder that a merchant in their portfolio is
  // overdue. Additive only: `public/sw.js` never switches on `kind` (it only
  // reads `title`/`body`/`url`/`tag` generically), so this widening is a
  // zero-blast-radius change to every existing caller.
  kind: 'new_message' | 'offer' | 'order' | 'portfolio_reminder'
  title: string
  body: string
  url: string
  tag?: string
}

/** Fire a push to all of a user's registered devices. No-op if push isn't
 *  configured or the user has no subscriptions. Prunes dead subscriptions. */
export async function notify(userId: string, event: NotifyEvent): Promise<void> {
  if (!ensureVapid()) return
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('clerk_user_id', userId)
  if (!subs?.length) return

  const payload = JSON.stringify({
    title: event.title,
    body: event.body,
    url: event.url,
    tag: event.tag ?? event.kind,
  })

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          await db.from('push_subscriptions').delete().eq('id', s.id)
        }
      }
    }),
  )
}
