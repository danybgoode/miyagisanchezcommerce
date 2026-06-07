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

export type NotifyEvent = {
  kind: 'new_message' | 'offer' | 'order'
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
