/**
 * lib/portfolio/confirm.ts
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.3 — pure helpers for the
 * no-auto-send boundary (README D5). ZERO-IMPORT: no `server-only`, no
 * `next/*`, no Clerk, no Supabase, so an `api` spec loads this with no
 * database.
 *
 * THE STRONGEST FORM OF "CANNOT AUTO-SEND" IS ABSENCE, NOT A GUARD (D5). This
 * file contains no `fetch`, no send call, nothing that reaches a network —
 * only a channel-membership check and a STRING BUILDER for a link the
 * BROWSER, not the server, will open. `buildConfirmDeepLink` returns a plain
 * string; nobody calls it.
 */

export type ConfirmChannel = 'whatsapp' | 'phone' | 'email' | 'instagram'

export const CONFIRM_CHANNELS: readonly ConfirmChannel[] = ['whatsapp', 'phone', 'email', 'instagram']

/** The merchant's raw contact VALUES — never rendered to a list, never stored
 *  anywhere but here; passed in fresh by the confirm route from the single
 *  record it already fetched under `resolveRelationshipAccess`. */
export interface KnownContacts {
  whatsapp: string | null
  phone: string | null
  email: string | null
  instagram: string | null
}

/** An OWN-PROPERTY check on a fixed literal union, never `channel in contacts`
 *  — `in` walks the prototype chain, and a caller-supplied string like
 *  `'toString'` would otherwise resolve to `Object.prototype.toString`
 *  (Sprint 1 review finding, `lib/portfolio/resolver.ts#buildPortfolioRow`).
 *  `CONFIRM_CHANNELS.includes` is safe here for the same reason it is safe
 *  there: it tests against a literal array, not the object's own keys. */
export function isConfirmChannel(value: string): value is ConfirmChannel {
  return CONFIRM_CHANNELS.includes(value as ConfirmChannel)
}

/** True when the relationship has a non-empty contact VALUE for `channel` —
 *  the "one of the merchant's KNOWN channels" gate (build contract, Story
 *  2.3). A channel that isn't one of the four known shapes, or whose value is
 *  blank, is never confirmable. */
export function isKnownChannel(channel: string, contacts: KnownContacts): channel is ConfirmChannel {
  if (!isConfirmChannel(channel)) return false
  const value = contacts[channel]
  return typeof value === 'string' && value.trim().length > 0
}

/** The channel ids this relationship actually has a contact value for, in
 *  `CONFIRM_CHANNELS` order — what the UI offers as confirmable options
 *  BEFORE the human picks one. Carries no value, only which channels exist. */
export function knownChannelsFor(contacts: KnownContacts): ConfirmChannel[] {
  return CONFIRM_CHANNELS.filter((c) => isKnownChannel(c, contacts))
}

/**
 * The BROWSER-opened deep link for a human-confirmed send. Only WhatsApp and
 * email have a reliable universal scheme; phone and Instagram do not (a
 * phone call can't carry text, and Instagram DMs have no unauthenticated
 * `https://` deep link), so the UI falls back to an explicit "copy the text"
 * affordance for those — never a server-side send (D5). Returns `null` when
 * there is nothing to open; that is a normal, expected result, not an error.
 *
 * PURE STRING CONSTRUCTION ONLY — no `fetch`, no send. The server hands this
 * string back to the client; the client's `<a href>`/`window.open` is what
 * actually reaches the merchant, and that happens outside this file, outside
 * this repo's server, entirely.
 */
export function buildConfirmDeepLink(channel: ConfirmChannel, contacts: KnownContacts, text: string): string | null {
  if (channel === 'whatsapp' && contacts.whatsapp) {
    const digits = contacts.whatsapp.replace(/[^\d]/g, '')
    if (!digits) return null
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
  }
  if (channel === 'email' && contacts.email) {
    return `mailto:${encodeURIComponent(contacts.email)}?body=${encodeURIComponent(text)}`
  }
  return null
}
