import 'server-only'
import { db } from '@/lib/supabase'
import { getSellerEmail } from '@/lib/email'
import { notify, type NotifyEvent } from '@/lib/notify'
import { tgSend } from '@/lib/telegram'
import {
  resolvePrefs,
  isChannelEnabled,
  telegramTarget,
  resolveBuyerPrefs,
  isBuyerChannelEnabled,
  type EventGroup,
  type BuyerEventGroup,
  type PrefRow,
  type TelegramLink,
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
 *   telegram → the seller's linked chat via `tgSend` (no-op when unlinked / off)
 */

export type SellerEvent = {
  group: EventGroup
  /** Closure that calls the right `lib/email.ts` sender with the resolved address. */
  email?: (to: string) => Promise<void>
  /** Web-push payload (optional). */
  push?: NotifyEvent
  /** Telegram body (HTML) — delivered to the seller's linked chat if enabled. */
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

async function readTelegramLink(clerkUserId: string): Promise<TelegramLink> {
  try {
    const { data } = await db
      .from('telegram_links')
      .select('chat_id')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle()
    return data ? { chat_id: (data as { chat_id: string }).chat_id } : null
  } catch {
    return null   // Telegram is opt-in + best-effort — never block on a read failure.
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

    // Telegram — opt-in: only when the group is on for Telegram AND the seller
    // has a linked chat. Unlinked / off ⇒ silent no-op (the chat read is skipped
    // entirely when the group isn't even enabled on Telegram).
    if (event.telegram && isChannelEnabled(prefs, event.group, 'telegram')) {
      const chatId = telegramTarget(prefs, event.group, await readTelegramLink(clerkUserId))
      if (chatId) await tgSend(chatId, event.telegram).catch(e => console.error('[dispatch] telegram:', e))
    }
  } catch (e) {
    console.error('[dispatch] failed:', e)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BUYER dispatch (epic #5b) — the sibling seam, re-aiming the same machine at the
// buyer audience. Reuses the same prefs table (buyer-namespaced rows), the same
// `notify` push, and (Sprint 2) the same `tgSend`. The buyer's email address is
// resolved from the ORDER (`buyer.email`), not from a Clerk lookup — many buyer
// events fire from seller-/system-triggered routes where the buyer isn't the actor.
// ══════════════════════════════════════════════════════════════════════════════

/** Who receives a buyer event — resolved from the order, not the session. */
export type BuyerRecipient = {
  /** The buyer's Clerk id, or null for a GUEST order (no account). */
  clerkUserId: string | null
  /** The order's buyer email — always present; the only channel a guest gets. */
  email: string
}

export type BuyerEvent = {
  group: BuyerEventGroup
  /** Closure that calls the right `lib/email.ts` buyer sender with the resolved address. */
  email?: (to: string) => Promise<void>
  /** Web-push payload (optional). */
  push?: NotifyEvent
  /** Telegram body (HTML) — wired in Sprint 2; ignored (stub no-op) in Sprint 1. */
  telegram?: string
}

/**
 * Single buyer-notification dispatch seam. Same contract as `dispatchToSeller`:
 * `server-only`, fire-and-forget, **never throws on the request path**; each
 * channel is `.catch`-isolated; pref reads degrade to defaults on failure.
 *
 * GUEST fall-through (safety-critical): an order with **no `clerkUserId`** has no
 * preferences, push, or Telegram — it degrades to *exactly today*: send the
 * transactional email to the order address and return. This keeps the guest
 * checkout path byte-for-byte unchanged.
 *
 * Signed-in buyers: the receipt email (Compras × email) is forced-on in the
 * resolver, so it always sends; every other cell respects the buyer's prefs.
 * Telegram is a stub no-op until Sprint 2 (no buyer link flow yet).
 */
export async function dispatchToBuyer(buyer: BuyerRecipient, event: BuyerEvent): Promise<void> {
  const to = buyer.email
  try {
    // GUEST fall-through — no account ⇒ today's behaviour, email only.
    if (!buyer.clerkUserId) {
      if (event.email && to) await event.email(to).catch(e => console.error('[dispatchBuyer] guest email:', e))
      return
    }

    const clerkUserId = buyer.clerkUserId
    const prefs = resolveBuyerPrefs(await readPrefs(clerkUserId))

    // Email — receipt cell is forced-on; everything else respects the toggle.
    if (event.email && to && isBuyerChannelEnabled(prefs, event.group, 'email')) {
      await event.email(to).catch(e => console.error('[dispatchBuyer] email:', e))
    }

    // Push — safe no-op when the buyer has no subscription.
    if (event.push && isBuyerChannelEnabled(prefs, event.group, 'push')) {
      await notify(clerkUserId, event.push).catch(e => console.error('[dispatchBuyer] push:', e))
    }

    // Telegram — stub no-op until Sprint 2 (the buyer link flow + send land there).
  } catch (e) {
    console.error('[dispatchBuyer] failed:', e)
  }
}
