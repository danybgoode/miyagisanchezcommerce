import 'server-only'
/**
 * "Someone wrote to you about an anuncio" — the one dispatch both conversation
 * write paths use.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * Until 2026-08-15 there was no such thing. `POST /api/conversations/start` wrote
 * the stamp event, set `seller_unread = 1`, and notified NOBODY — the seller was
 * expected to discover a buyer's question from an unread badge. A reply
 * (`/api/conversations/[id]/stamp`) sent web push only, straight through
 * `lib/notify.ts`, bypassing the preference seam entirely.
 *
 * Web push is a silent no-op for anyone with no subscription, which is most sellers
 * (the seller in the audited order had zero). So a buyer pressing "Preguntar"
 * reached the seller through no channel at all — and the only surface that would
 * have shown it, `/messages`, was itself returning a swallowed 400.
 *
 * Contract: NEVER throws, never blocks the send. A message that was stored but not
 * announced is still a stored message; a failed announcement must not lose it.
 */
import { db } from '@/lib/supabase'
import { dispatchToSeller, dispatchToBuyer } from '@/lib/notifications/dispatch'
import { sendConversationMessage } from '@/lib/email'
import { escapeHtml } from '@/lib/telegram'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

export type ConversationMessageNotice = {
  conversationId: string
  /** Clerk id of whoever should be told. Null ⇒ nobody to tell; caller logs it. */
  recipientClerkUserId: string | null
  /** What the RECIPIENT is — a buyer's message goes to the seller, and vice versa. */
  recipientRole: 'buyer' | 'seller'
  listingTitle: string
  messageText: string
}

/**
 * The buyer's email address, for the buyer arm of the seam.
 *
 * `dispatchToBuyer` takes `{ clerkUserId, email }` because a buyer may be a guest.
 * Here they never are — a conversation requires a signed-in buyer — but the seam
 * still wants an address, and looking it up from Clerk is `getSellerEmail`'s job on
 * the other side. Returns null rather than guessing.
 */
async function buyerEmailFor(clerkUserId: string): Promise<string | null> {
  try {
    const { getSellerEmail } = await import('@/lib/email')
    // Same Clerk lookup, despite the seller-flavoured name — it resolves any Clerk
    // user's primary address. Renaming it is a wider change than this fix.
    return await getSellerEmail(clerkUserId)
  } catch {
    return null
  }
}

export async function notifyConversationMessage(notice: ConversationMessageNotice): Promise<void> {
  const { conversationId, recipientClerkUserId, recipientRole, listingTitle, messageText } = notice

  if (!recipientClerkUserId) {
    // An unclaimed shop has no Clerk owner. Said out loud: a buyer just asked a
    // question nobody will ever see, which is a product fact worth knowing.
    console.error('[conversation-notify] no recipient for conversation', conversationId)
    return
  }

  const url = `${SITE}/messages/${conversationId}`
  const push = {
    kind: 'new_message' as const,
    title: recipientRole === 'seller' ? 'Un comprador te escribió' : 'El vendedor te respondió',
    body: messageText,
    url: `/messages/${conversationId}`,
    tag: `conv:${conversationId}`,
  }
  const telegram =
    `💬 <b>${recipientRole === 'seller' ? 'Un comprador te escribió' : 'El vendedor te respondió'}</b>\n`
    + `${escapeHtml(listingTitle)}\n${escapeHtml(messageText)}`

  try {
    if (recipientRole === 'seller') {
      await dispatchToSeller(recipientClerkUserId, {
        group: 'mensajes',
        email: (to) => sendConversationMessage({
          to, recipientRole: 'seller', listingTitle, messageText, conversationUrl: url,
        }),
        push,
        telegram,
      })
    } else {
      // `BuyerRecipient.email` is typed non-null because an order always carries one.
      // A conversation does not: the address comes from Clerk and can be missing. ''
      // is the honest "no address" here — `dispatchToBuyer` skips the email arm on a
      // falsy address and still delivers push/Telegram, which is what we want.
      const buyerEmail = await buyerEmailFor(recipientClerkUserId)
      await dispatchToBuyer(
        { clerkUserId: recipientClerkUserId, email: buyerEmail ?? '' },
        {
          group: 'buyer.mensajes',
          email: (to) => sendConversationMessage({
            to, recipientRole: 'buyer', listingTitle, messageText, conversationUrl: url,
          }),
          push,
          telegram,
        },
      )
    }
  } catch (e) {
    console.error('[conversation-notify] dispatch failed:', e)
  }
}

/**
 * Resolve who to tell for a conversation the caller has already loaded partially.
 * Kept here so both routes read the counterparty the same way — `start` knows the
 * seller directly, `stamp` has to flip on who sent it.
 */
export async function listingTitleForConversation(conversationId: string): Promise<string> {
  try {
    const { data } = await db
      .from('marketplace_conversations')
      .select('marketplace_listings ( title )')
      .eq('id', conversationId)
      .maybeSingle()
    const listing = data?.marketplace_listings as unknown as { title?: string } | null
    return listing?.title ?? 'tu anuncio'
  } catch {
    return 'tu anuncio'
  }
}
