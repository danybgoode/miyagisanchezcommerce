import 'server-only'
import { db } from '@/lib/supabase'
import { getSellerEmail } from '@/lib/email'
import { notify, type NotifyEvent } from '@/lib/notify'
import {
  resolvePrefs,
  isChannelEnabled,
  type EventGroup,
  type PrefRow,
} from '@/lib/notifications/preferences'

/**
 * Single seller-notification dispatch seam. Resolves the seller's per-channel
 * preferences (default-on for absent rows) and fans out to the enabled channels.
 *
 * Contract — same as `tgNotify`/`notify`: fire-and-forget, **never throws on the
 * request path**. Callers do not await delivery; a failure in one channel never
 * blocks the others or the request.
 *
 * Channels:
 *   email    → the matching `lib/email.ts` sender, passed as a closure
 *   push     → `lib/notify.ts` (no-op when the seller has no push subscription)
 *   telegram → STUB no-op until Sprint 2 lights up the seller Telegram channel
 */

export type SellerEvent = {
  group: EventGroup
  /** Closure that calls the right `lib/email.ts` sender with the resolved address. */
  email?: (to: string) => Promise<void>
  /** Web-push payload (optional). */
  push?: NotifyEvent
  /** Telegram body — wired in Sprint 2; ignored this sprint. */
  telegram?: string
}

async function readPrefs(clerkUserId: string): Promise<PrefRow[]> {
  try {
    const { data } = await db
      .from('notification_preferences')
      .select('channel, event_group, enabled')
      .eq('clerk_user_id', clerkUserId)
    return (data as PrefRow[] | null) ?? []
  } catch {
    // Degrade gracefully → DEFAULT_PREFS (e.g. the table is briefly absent during
    // the deploy-lag window). The 99% default-on path stays unchanged.
    return []
  }
}

export async function dispatchToSeller(clerkUserId: string, event: SellerEvent): Promise<void> {
  if (!clerkUserId) return
  try {
    const prefs = resolvePrefs(await readPrefs(clerkUserId))

    // Email — resolve the address once, only if the channel is on for this group.
    if (event.email && isChannelEnabled(prefs, event.group, 'email')) {
      const to = await getSellerEmail(clerkUserId)
      if (to) await event.email(to).catch(e => console.error('[dispatch] email:', e))
    }

    // Push — safe no-op when the seller has no subscription.
    if (event.push && isChannelEnabled(prefs, event.group, 'push')) {
      await notify(clerkUserId, event.push).catch(e => console.error('[dispatch] push:', e))
    }

    // Telegram — STUB until Sprint 2 (seller channel link + tgSend).
    // if (event.telegram && isChannelEnabled(prefs, event.group, 'telegram')) { … }
  } catch (e) {
    console.error('[dispatch] failed:', e)
  }
}
